"""Packet-capture endpoints: Edgeshark lifecycle + browser Wireshark (noVNC).

Mirrors the containerlab VS Code extension's capture stack:

* **Edgeshark** (https://github.com/siemens/edgeshark) is started on the
  docker host by netlab's own ``edgeshark`` tool definition (the same one
  ``tools: [ edgeshark ]`` uses). Its ``packetflix`` container (``edgeshark``,
  port 5001, network ``ghost-in-da-edge``) streams packets out of any
  container's network namespace.
* **Wireshark VNC** runs ``ghcr.io/srl-labs/wireshark-vnc-docker`` attached to
  the edgeshark network with a ``PACKETFLIX_LINK`` pointing at the packetflix
  service, and publishes its noVNC web UI (container port 5800) on an
  ephemeral host port the browser can open directly — no client-side
  Wireshark/extcap install needed.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import shutil
import urllib.parse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.netlab import tools

router = APIRouter()

# netlab's edgeshark tool (netsim/tools/edgeshark.yml): packetflix + gostwire.
EDGESHARK_TOOL = "edgeshark"
PACKETFLIX_CONTAINER = "edgeshark"
EDGESHARK_CONTAINERS = (PACKETFLIX_CONTAINER, "gostwire")
# Earlier releases ran Edgeshark's own compose file (project "edgeshark");
# those containers hold port 5001, so an install removes them first.
LEGACY_CONTAINERS = ("edgeshark-edgeshark-1", "edgeshark-gostwire-1")
PACKETFLIX_PORT = 5001
WIRESHARK_VNC_IMAGE = os.environ.get("NETLAB_APP_WIRESHARK_VNC_IMAGE", "ghcr.io/srl-labs/wireshark-vnc-docker:latest")
WIRESHARK_VNC_HTTP_PORT = 5800
VNC_CONTAINER_PREFIX = "netlab-ws-"
# Host address the Wireshark web UI is published on. The noVNC page has no
# login, so it follows the UI's own bind address (loopback unless the UI was
# deliberately exposed) instead of docker's default of every interface.
CAPTURE_BIND = os.environ.get("NETLAB_APP_CAPTURE_BIND") or os.environ.get("UVICORN_HOST") or "127.0.0.1"

_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
_IFACE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/-]*")


class EdgesharkStatus(BaseModel):
    installed: bool
    running: bool


class CaptureOpResult(BaseModel):
    ok: bool
    message: str


class VncCaptureRequest(BaseModel):
    container: str
    interface: str
    darkMode: bool = False


class VncCaptureSession(BaseModel):
    containerName: str
    port: int


async def _docker(args: list[str], *, input_text: str | None = None, timeout: float = 60.0) -> tuple[int, str, str]:
    binary = shutil.which("docker")
    if not binary:
        raise HTTPException(status_code=503, detail="docker was not found on PATH")
    proc = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.PIPE if input_text is not None else asyncio.subprocess.DEVNULL,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input_text.encode() if input_text is not None else None), timeout
        )
    except TimeoutError:
        proc.kill()
        raise HTTPException(status_code=504, detail=f"docker {args[0]} timed out after {timeout:.0f}s") from None
    return proc.returncode or 0, stdout.decode(), stderr.decode()


async def _edgeshark_containers(names: tuple[str, ...] = EDGESHARK_CONTAINERS) -> dict[str, str]:
    """``{container name: state}`` of Edgeshark's containers that exist."""
    code, out, _err = await _docker(["ps", "-a", "--format", "{{.Names}}\t{{.State}}"])
    if code != 0:
        return {}
    entries: dict[str, str] = {}
    for line in out.splitlines():
        name, _sep, state = line.partition("\t")
        if name in names:
            entries[name] = state.strip().lower()
    return entries


async def _remove_legacy_install() -> None:
    legacy = await _edgeshark_containers(LEGACY_CONTAINERS)
    if legacy:
        await _docker(["rm", "-f", *legacy])
        await _docker(["network", "rm", "edgeshark_default"])


async def _netlab_tool(action: str) -> CaptureOpResult:
    # packetflix is unauthenticated and can read every container's network
    # namespace: netlab's definition publishes it on every interface, so publish
    # it where the UI itself listens instead. The Wireshark container reaches it
    # over the docker network and does not need the published port.
    result = await tools.host_tool(EDGESHARK_TOOL, action, bind=CAPTURE_BIND if action == "up" else None)
    if result.code:
        raise HTTPException(status_code=502, detail=result.stderr.strip() or f"netlab edgeshark {action} failed")
    return CaptureOpResult(ok=True, message=result.stdout.strip())


@router.get("/capture/edgeshark", response_model=EdgesharkStatus)
async def edgeshark_status():
    containers = await _edgeshark_containers()
    return EdgesharkStatus(installed=bool(containers), running=any(s == "running" for s in containers.values()))


# How long an install waits for Edgeshark's containers to stay up.
_UP_TIMEOUT = 20.0


async def _wait_until_running() -> None:
    """`docker run -d` succeeds even when a container then crashes; wait for
    Edgeshark to actually be up and say why if it is not."""
    deadline = asyncio.get_running_loop().time() + _UP_TIMEOUT
    containers: dict[str, str] = {}
    while asyncio.get_running_loop().time() < deadline:
        containers = await _edgeshark_containers()
        if containers and all(state == "running" for state in containers.values()):
            await asyncio.sleep(2)  # a crash-looping container is "running" for a moment
            containers = await _edgeshark_containers()
            if containers and all(state == "running" for state in containers.values()):
                return
        await asyncio.sleep(1)
    broken = [name for name, state in containers.items() if state != "running"] or list(containers)
    logs = ""
    if broken:
        _code, out, err = await _docker(["logs", "--tail", "15", broken[0]])
        logs = (err or out).strip()
    detail = f"Edgeshark started but {', '.join(broken) or 'its containers'} did not stay running."
    raise HTTPException(status_code=502, detail=f"{detail} {logs}".strip())


async def _pull_wireshark_image() -> None:
    """The browser Wireshark image is large; pull it now instead of stalling the
    first capture (whose request would then wait on the download)."""
    code, out, err = await _docker(["pull", WIRESHARK_VNC_IMAGE], timeout=570.0)
    if code != 0:
        detail = (err or out).strip() or f"docker pull exited with {code}"
        raise HTTPException(
            status_code=502,
            detail=f"Edgeshark is running, but the Wireshark image {WIRESHARK_VNC_IMAGE} could not be pulled: {detail}",
        )


@router.post("/capture/edgeshark/install", response_model=CaptureOpResult)
async def edgeshark_install():
    """Everything browser capture needs: Edgeshark's two containers (running,
    not just created) and the Wireshark image. First run pulls images, so this
    allows minutes."""
    await _remove_legacy_install()
    result = await _netlab_tool("up")
    await _wait_until_running()
    await _pull_wireshark_image()
    return CaptureOpResult(ok=True, message=result.message or "Edgeshark and the Wireshark image are ready")


@router.post("/capture/edgeshark/uninstall", response_model=CaptureOpResult)
async def edgeshark_uninstall():
    await _remove_legacy_install()
    return await _netlab_tool("down")


async def _packetflix_endpoint() -> tuple[str, str]:
    """(container name, docker network) of the running packetflix service."""
    containers = await _edgeshark_containers()
    if containers.get(PACKETFLIX_CONTAINER) != "running":
        raise HTTPException(
            status_code=409,
            detail="Edgeshark is not running on the docker host — install it from the capture "
            "dialog's 'Install Edgeshark' button first.",
        )
    code, out, err = await _docker(
        ["inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}", PACKETFLIX_CONTAINER]
    )
    networks = [line for line in out.splitlines() if line.strip()]
    if code != 0 or not networks:
        raise HTTPException(status_code=502, detail=f"Could not determine the edgeshark docker network: {err.strip()}")
    return PACKETFLIX_CONTAINER, networks[0]


def _packetflix_link(packetflix_host: str, container: str, interface: str) -> str:
    container_json = json.dumps({"name": container, "type": "docker", "network-interfaces": [interface]})
    query = f"container={urllib.parse.quote(container_json)}&nif={urllib.parse.quote(interface)}"
    return f"packetflix:ws://{packetflix_host}:{PACKETFLIX_PORT}/capture?{query}"


async def _published_port(container_name: str) -> int:
    _code, out, err = await _docker(["port", container_name, f"{WIRESHARK_VNC_HTTP_PORT}/tcp"])
    for line in out.splitlines():
        _host, _sep, port = line.rpartition(":")
        if port.isdigit():
            return int(port)
    detail = f"Could not read the Wireshark container's port: {(err or out).strip()}"
    raise HTTPException(status_code=502, detail=detail)


async def _wait_for_http(port: int, container_name: str, attempts: int = 60) -> None:
    """Poll the noVNC web server; the jlesage GUI base image needs a few seconds to boot."""
    for _ in range(attempts):
        code, out, _err = await _docker(["inspect", "-f", "{{.State.Running}}", container_name])
        if code != 0 or out.strip() != "true":
            raise HTTPException(status_code=502, detail="The Wireshark container exited before becoming ready")
        try:
            probe_host = "127.0.0.1" if CAPTURE_BIND in {"0.0.0.0", "::", ""} else CAPTURE_BIND
            reader, writer = await asyncio.wait_for(asyncio.open_connection(probe_host, port), 2)
            writer.write(b"GET / HTTP/1.0\r\nHost: localhost\r\n\r\n")
            await writer.drain()
            head = await asyncio.wait_for(reader.read(12), 2)
            writer.close()
            if head.startswith(b"HTTP/"):
                return
        except OSError:
            pass
        await asyncio.sleep(1)
    raise HTTPException(status_code=504, detail="Timed out waiting for the Wireshark web UI to become ready")


@router.post("/capture/vnc", response_model=VncCaptureSession)
async def start_vnc_capture(body: VncCaptureRequest):
    if not _NAME_RE.fullmatch(body.container):
        raise HTTPException(status_code=400, detail=f"Invalid container name: {body.container!r}")
    if not _IFACE_RE.fullmatch(body.interface):
        raise HTTPException(status_code=400, detail=f"Invalid interface name: {body.interface!r}")

    packetflix, network = await _packetflix_endpoint()
    link = _packetflix_link(packetflix, body.container, body.interface)
    safe_suffix = re.sub(r"[^A-Za-z0-9_.-]", "-", f"{body.container}-{body.interface}")
    name = f"{VNC_CONTAINER_PREFIX}{safe_suffix}-{secrets.token_hex(3)}"

    run_args = [
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        "--network",
        network,
        "-e",
        f"PACKETFLIX_LINK={link}",
        *(["-e", "DARK_MODE=1"] if body.darkMode else []),
        "-p",
        f"{CAPTURE_BIND}::{WIRESHARK_VNC_HTTP_PORT}",
        WIRESHARK_VNC_IMAGE,
    ]
    # First run pulls the wireshark image — allow for that.
    code, out, err = await _docker(run_args, timeout=570.0)
    if code != 0:
        raise HTTPException(status_code=502, detail=(err or out).strip() or "docker run failed")

    try:
        port = await _published_port(name)
        await _wait_for_http(port, name)
    except HTTPException:
        await _docker(["rm", "-f", name])
        raise
    return VncCaptureSession(containerName=name, port=port)


@router.post("/capture/vnc/kill-all", response_model=CaptureOpResult)
async def kill_all_vnc_captures():
    code, out, err = await _docker(["ps", "-aq", "--filter", f"name={VNC_CONTAINER_PREFIX}"])
    if code != 0:
        raise HTTPException(status_code=502, detail=err.strip() or "docker ps failed")
    ids = [line for line in out.splitlines() if line.strip()]
    if ids:
        code, _out, err = await _docker(["rm", "-f", *ids])
        if code != 0:
            raise HTTPException(status_code=502, detail=err.strip() or "docker rm failed")
    return CaptureOpResult(ok=True, message=f"Removed {len(ids)} Wireshark container(s)")
