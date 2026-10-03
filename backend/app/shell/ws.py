"""Web shell: bridge a PTY running ``netlab connect <node>`` to a WebSocket.

The frontend attaches xterm.js to this socket. Because ``netlab connect``
abstracts the provider, the *same* code path gives an interactive shell into a
containerlab container (``docker exec``) or a libvirt VM (SSH) — which is what
makes the multi-provider story tractable for the UI.

Protocol: raw terminal bytes flow both directions. A client text frame of the
form ``{"resize": {"cols": C, "rows": R}}`` resizes the PTY.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from app import auth
from app.lab import common
from services import host
from services.netlab import runner
from services.netlab import runtime as runtime_state

router = APIRouter(tags=["shell"])


def _logs_unavailable(node: str, provider: str) -> str | None:
    """Why a node has no container log stream (None when it has one)."""
    if provider == "clab":
        return None
    if provider == "libvirt":
        return (
            f"{node} is a libvirt VM — there is no container log to stream. "
            "Open its shell (netlab connect) and read the device's own logs there."
        )
    return f"{node} is an external device — netlab doesn't run it, so there are no logs to stream from here."


@router.websocket("/api/node/{node}/shell")
async def node_shell(websocket: WebSocket, node: str, sessionId: str):
    await websocket.accept()
    try:
        topology_path = Path(common.session_path(sessionId))
        argv = runner.connect_argv(node)
    except (HTTPException, runner.NetlabNotInstalled) as exc:
        await websocket.send_text(f"\r\n[netlab unavailable] {exc}\r\n")
        await websocket.close()
        return

    await bridge_pty(websocket, argv, topology_path.parent)


# Settings of netlab-ui itself that a terminal started from it must not inherit.
_NOT_FOR_TERMINALS = ("NETLAB_UI_AUTH", "NETLAB_UI_AUTH_FILE", "NETLAB_APP_ASSISTANT_TOKEN")


@router.websocket("/api/shell/local")
async def local_shell(websocket: WebSocket, sessionId: str):
    """A normal terminal in the lab's folder, as the user. In a container that can reach its host
    (see services.host) it is the host's shell, not the container's, so it is the terminal the user
    would open themselves. Same rule as agent terminals: only from this machine, unless there is a login."""
    await websocket.accept()
    if not auth.local_process_allowed(websocket.client.host if websocket.client else None):
        await websocket.send_text(
            "\r\n[terminals are only available from the netlab-ui machine itself unless a login is "
            "configured (NETLAB_UI_AUTH)]\r\n"
        )
        await websocket.close()
        return
    try:
        lab_dir = Path(common.session_path(sessionId)).parent
    except HTTPException as exc:
        await websocket.send_text(f"\r\n[unknown session: {exc.detail}]\r\n")
        await websocket.close()
        return
    shell = await asyncio.to_thread(host.login_shell)
    argv, env = host.wrap([shell, "-i"], {}, lab_dir)
    # Native mode runs in this process's environment: do not hand the login to the terminal.
    env = {**dict.fromkeys(_NOT_FOR_TERMINALS, ""), **env}
    await bridge_pty(websocket, argv, lab_dir, env)


_IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
_MAX_IMAGE_BYTES = 20 * 1024 * 1024


@router.post("/api/shell/paste-image")
async def paste_image(request: Request, sessionId: str) -> dict[str, str]:
    """Save an image pasted or dropped into a terminal in the lab's folder and return its path.
    The agent CLIs read the *backend's* clipboard, which a browser paste never reaches, so the UI
    uploads the image here and types the file's path into the terminal instead."""
    if not auth.local_process_allowed(request.client.host if request.client else None):
        raise HTTPException(
            403, "terminals are only available from the netlab-ui machine itself unless a login is configured"
        )
    extension = _IMAGE_TYPES.get(request.headers.get("content-type", "").split(";")[0].strip().lower())
    if extension is None:
        raise HTTPException(415, "only png, jpeg, gif and webp images can be pasted")
    data = await request.body()
    if not data or len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(413, "the image is empty or larger than 20 MB")
    folder = Path(common.session_path(sessionId)).parent / ".pasted-images"
    await asyncio.to_thread(folder.mkdir, parents=True, exist_ok=True)
    target = folder / f"paste-{time.strftime('%Y%m%d-%H%M%S')}-{os.urandom(2).hex()}.{extension}"
    await asyncio.to_thread(target.write_bytes, data)
    return {"path": str(target)}


async def bridge_pty(websocket: WebSocket, argv: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    """Run ``argv`` in a PTY and pump it to an accepted WebSocket until either
    side goes away. A real PTY is what makes interactive programs (vtysh, bash,
    full-screen wizards, agent CLIs) behave."""
    import ptyprocess

    proc = ptyprocess.PtyProcess.spawn(
        argv,
        cwd=str(cwd),
        env={**os.environ, "TERM": "xterm-256color", "PWD": str(cwd), **(env or {})},
    )
    loop = asyncio.get_event_loop()

    async def pump_pty_to_ws():
        while proc.isalive():
            try:
                data = await loop.run_in_executor(None, proc.read, 1024)
            except EOFError:
                break
            await websocket.send_bytes(data)
        # The program exited (e.g. the user quit the agent): end the session.
        with contextlib.suppress(Exception):
            await websocket.close()

    pty_task = asyncio.create_task(pump_pty_to_ws())
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "bytes" in message and message["bytes"] is not None:
                proc.write(message["bytes"])
            elif "text" in message and message["text"] is not None:
                _handle_text(proc, message["text"])
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        pty_task.cancel()
        if proc.isalive():
            proc.terminate(force=True)


@router.websocket("/api/lab/graph/drawio/interactive")
async def drawio_interactive(websocket: WebSocket, sessionId: str):
    """Bridge clab-io-draw's interactive assign-levels wizard (`containerlab
    graph --drawio --drawio-args --interactive`) to a WebSocket, the same way
    node_shell bridges `netlab connect`. That wizard is a full-screen terminal
    UI (arrow keys/space/enter) — it needs a real TTY to render and to receive
    input, which a plain subprocess doesn't have, so it can only run through
    this PTY bridge, not the plain-subprocess `export_drawio()` path."""
    await websocket.accept()
    try:
        topology_path = Path(common.session_path(sessionId))
        argv = runner.drawio_interactive_argv(topology_path)
    except (HTTPException, runner.NetlabNotInstalled, FileNotFoundError) as exc:
        await websocket.send_text(f"\r\n[draw.io export unavailable] {exc}\r\n")
        await websocket.close()
        return

    await bridge_pty(websocket, argv, topology_path.parent)


def _handle_text(proc, text: str) -> None:
    try:
        msg = json.loads(text)
    except json.JSONDecodeError:
        proc.write(text.encode())
        return
    resize = msg.get("resize")
    if resize:
        proc.setwinsize(int(resize.get("rows", 24)), int(resize.get("cols", 80)))


@router.websocket("/api/node/{node}/logs")
async def node_logs(websocket: WebSocket, node: str, sessionId: str):
    """Stream stdout/stderr from a running Docker or Podman containerlab node."""
    await websocket.accept()
    try:
        topology_path = common.session_path(sessionId)
        from app.contract import commands

        topology = commands.load_topology(topology_path)
        status = await runner.status_for(topology_path, max_age=0)
        info = (status.get("nodes") or {}).get(node) if isinstance(status, dict) else None
        if not isinstance(info, dict):
            await websocket.send_json({"stream": "stderr", "line": f"No running node named {node}"})
            await websocket.close()
            return
        reason = _logs_unavailable(node, str(info.get("provider") or "clab"))
        if reason:
            await websocket.send_json({"stream": "stderr", "line": reason})
            await websocket.close()
            return
        runtime_bin = runner.container_runtime_binary(runtime_state.clab_runtime(topology))
        if not runtime_bin:
            await websocket.send_json({"stream": "stderr", "line": "docker or podman is not available on the backend"})
            await websocket.close()
            return
        container = str(info.get("provider_name") or node)
        proc = await asyncio.create_subprocess_exec(
            runtime_bin,
            "logs",
            "--follow",
            "--tail",
            "200",
            container,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def pump(stream: asyncio.StreamReader, name: str):
            async for raw in stream:
                await websocket.send_json({"stream": name, "line": raw.decode(errors="replace").rstrip("\r\n")})

        tasks = [
            asyncio.create_task(pump(proc.stdout, "stdout")),
            asyncio.create_task(pump(proc.stderr, "stderr")),
        ]
        try:
            while True:
                await websocket.receive()
        except WebSocketDisconnect:
            pass
        finally:
            for task in tasks:
                task.cancel()
            if proc.returncode is None:
                proc.terminate()
                await proc.wait()
    except (HTTPException, KeyError, runner.NetlabError, runner.NetlabNotInstalled) as exc:
        await websocket.send_json({"stream": "stderr", "line": str(exc)})
        await websocket.close()
