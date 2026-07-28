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
import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.lab import common
from services.netlab import runner
from services.netlab import runtime as runtime_state

router = APIRouter(tags=["shell"])


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

    # ptyprocess gives us a real PTY so interactive programs (vtysh, bash) behave.
    import ptyprocess

    proc = ptyprocess.PtyProcess.spawn(
        argv,
        cwd=str(topology_path.parent),
        env={**os.environ, "TERM": "xterm-256color"},
    )
    loop = asyncio.get_event_loop()

    async def pump_pty_to_ws():
        while proc.isalive():
            try:
                data = await loop.run_in_executor(None, proc.read, 1024)
            except EOFError:
                break
            await websocket.send_bytes(data)

    pty_task = asyncio.create_task(pump_pty_to_ws())
    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"] is not None:
                proc.write(message["bytes"])
            elif "text" in message and message["text"] is not None:
                _handle_text(proc, message["text"])
    except WebSocketDisconnect:
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

    import ptyprocess

    proc = ptyprocess.PtyProcess.spawn(
        argv,
        cwd=str(topology_path.parent),
        env={**os.environ, "TERM": "xterm-256color"},
    )
    loop = asyncio.get_event_loop()

    async def pump_pty_to_ws():
        while proc.isalive():
            try:
                data = await loop.run_in_executor(None, proc.read, 1024)
            except EOFError:
                break
            await websocket.send_bytes(data)

    pty_task = asyncio.create_task(pump_pty_to_ws())
    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"] is not None:
                proc.write(message["bytes"])
            elif "text" in message and message["text"] is not None:
                _handle_text(proc, message["text"])
    except WebSocketDisconnect:
        pass
    finally:
        pty_task.cancel()
        if proc.isalive():
            proc.terminate(force=True)


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
        runtime_bin = runner.container_runtime_binary(runtime_state.clab_runtime(topology))
        if not runtime_bin:
            await websocket.send_json({"stream": "stderr", "line": "docker or podman is not available on the backend"})
            await websocket.close()
            return
        status = await runner.status_for(topology_path, max_age=0)
        info = (status.get("nodes") or {}).get(node) if isinstance(status, dict) else None
        if not isinstance(info, dict):
            await websocket.send_json({"stream": "stderr", "line": f"No running node named {node}"})
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
