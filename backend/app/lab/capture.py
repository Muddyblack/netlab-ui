"""Packet-capture endpoints: Edgeshark lifecycle + browser Wireshark (noVNC).

Mirrors the containerlab VS Code extension's capture stack:

* **Edgeshark** (https://github.com/siemens/edgeshark) is deployed on the
  docker host from its published compose file. Its ``packetflix`` service
  (container ``edgeshark-edgeshark-1``, port 5001) streams packets out of any
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
import urllib.request

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

router = APIRouter()

EDGESHARK_COMPOSE_URL = os.environ.get(
    "NETLAB_APP_EDGESHARK_COMPOSE_URL",
    "https://github.com/siemens/edgeshark/raw/main/deployments/wget/docker-compose.yaml",
)
EDGESHARK_PROJECT = "edgeshark"
PACKETFLIX_PORT = 5001
WIRESHARK_VNC_IMAGE = os.environ.get("NETLAB_APP_WIRESHARK_VNC_IMAGE", "ghcr.io/srl-labs/wireshark-vnc-docker:latest")
WIRESHARK_VNC_HTTP_PORT = 5800
VNC_CONTAINER_PREFIX = "netlab-ws-"

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


async def _edgeshark_containers() -> dict[str, str]:
    """``{container name: state}`` for the edgeshark compose project's containers."""
    code, out, _err = await _docker(
        ["ps", "-a", "--filter", f"name={EDGESHARK_PROJECT}-", "--format", "{{.Names}}\t{{.State}}"]
    )
    if code != 0:
        return {}
    entries: dict[str, str] = {}
    for line in out.splitlines():
        name, _sep, state = line.partition("\t")
        if name:
            entries[name] = state.strip().lower()
    return entries


def _fetch_compose_yaml() -> str:
    try:
        with urllib.request.urlopen(EDGESHARK_COMPOSE_URL, timeout=30) as res:
            return res.read().decode()
    except OSError as err:
        raise HTTPException(status_code=502, detail=f"Failed to download the edgeshark compose file: {err}") from err


async def _compose(action: list[str], timeout: float) -> CaptureOpResult:
    yaml_text = await run_in_threadpool(_fetch_compose_yaml)
    code, out, err = await _docker(
        ["compose", "-p", EDGESHARK_PROJECT, "-f", "-", *action], input_text=yaml_text, timeout=timeout
    )
    if code != 0:
        raise HTTPException(status_code=502, detail=(err or out).strip() or f"docker compose exited with {code}")
    return CaptureOpResult(ok=True, message=(err or out).strip())


@router.get("/capture/edgeshark", response_model=EdgesharkStatus)
async def edgeshark_status():
    containers = await _edgeshark_containers()
    return EdgesharkStatus(installed=bool(containers), running=any(s == "running" for s in containers.values()))


@router.post("/capture/edgeshark/install", response_model=CaptureOpResult)
async def edgeshark_install():
    # First run pulls the ghostwire + packetflix images, so allow minutes.
    return await _compose(["up", "-d"], timeout=570.0)


@router.post("/capture/edgeshark/uninstall", response_model=CaptureOpResult)
async def edgeshark_uninstall():
    return await _compose(["down"], timeout=120.0)


async def _packetflix_endpoint() -> tuple[str, str]:
    """(container name, docker network) of the running packetflix service."""
    running = [name for name, state in (await _edgeshark_containers()).items() if state == "running"]
    if not running:
        raise HTTPException(
            status_code=409,
            detail="Edgeshark is not running on the docker host — install it via the explorer's "
            "'Install Edgeshark' action first.",
        )
    # The compose project has two services; packetflix is the one the VNC
    # container must talk to (service "edgeshark" → edgeshark-edgeshark-1).
    code, out, _err = await _docker(
        ["ps", "--filter", f"name={EDGESHARK_PROJECT}-", "--format", "{{.Names}}\t{{.Image}}"]
    )
    packetflix = next(
        (line.split("\t")[0] for line in out.splitlines() if code == 0 and "packetflix" in line.lower()), running[0]
    )
    code, out, err = await _docker(
        ["inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}", packetflix]
    )
    networks = [line for line in out.splitlines() if line.strip()]
    if code != 0 or not networks:
        raise HTTPException(status_code=502, detail=f"Could not determine the edgeshark docker network: {err.strip()}")
    return packetflix, networks[0]


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
            reader, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), 2)
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
        str(WIRESHARK_VNC_HTTP_PORT),
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
