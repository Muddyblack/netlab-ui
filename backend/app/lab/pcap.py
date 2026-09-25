"""Packet capture to a pcap file — no Edgeshark, no tcpdump in the image.

A short helper (``_CAPTURE_SCRIPT``) runs as its own process, joins the
node container's network namespace (``setns`` on ``/proc/<pid>/ns/net``),
opens an ``AF_PACKET`` socket on the interface and writes a classic pcap
stream to stdout. The endpoint streams that to the browser as a download,
or to ``curl … | wireshark -k -i -`` for a live capture.

Only the helper changes namespace; the backend process never does. It needs
the privileges packet capture always needs (root, or CAP_NET_RAW +
CAP_SYS_ADMIN, and the container's PID visible — the full image runs
``--privileged --pid host``).
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import sys
import time

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.lab import common
from services.netlab import runner
from services.netlab import runtime as runtime_state

router = APIRouter()

MAX_SECONDS = 3600
MAX_PACKETS = 1_000_000
_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,63}$")

# Kept dependency-free and small: it is exec'd with the backend's interpreter.
# VLAN tags the kernel moved into packet metadata are put back into the frame
# (PACKET_AUXDATA), like tcpdump does — netlab labs are full of VLANs.
_CAPTURE_SCRIPT = r"""
import ctypes, os, select, socket, struct, sys, time
pid, iface, seconds, max_packets = int(sys.argv[1]), sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
libc = ctypes.CDLL(None, use_errno=True)
fd = os.open(f"/proc/{pid}/ns/net", os.O_RDONLY)
if libc.setns(fd, 0x40000000) != 0:
    sys.exit(f"cannot enter the node's network namespace: {os.strerror(ctypes.get_errno())}")
sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0003))
sock.setsockopt(263, 8, 1)  # SOL_PACKET, PACKET_AUXDATA
try:
    sock.bind((iface, 0))
except OSError as exc:
    sys.exit(f"cannot capture on {iface}: {exc.strerror}")
out = sys.stdout.buffer
out.write(struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 262144, 1))
out.flush()
deadline = time.monotonic() + seconds if seconds > 0 else None
count = 0
while count < max_packets:
    timeout = None if deadline is None else deadline - time.monotonic()
    if timeout is not None and timeout <= 0:
        break
    if not select.select([sock], [], [], timeout)[0]:
        break
    data, ancdata, _flags, _addr = sock.recvmsg(262144, socket.CMSG_SPACE(20))
    for level, kind, value in ancdata:
        if level == 263 and kind == 8 and len(value) >= 20:
            status, _l, _s, _m, _n, tci, tpid = struct.unpack("<IIIHHHH", value[:20])
            if status & 0x10 and len(data) >= 12:  # TP_STATUS_VLAN_VALID
                tpid = tpid if status & 0x40 and tpid else 0x8100
                data = data[:12] + struct.pack("!HH", tpid, tci) + data[12:]
    now = time.time()
    out.write(struct.pack("<IIII", int(now), int((now % 1) * 1e6), len(data), len(data)))
    out.write(data)
    out.flush()
    count += 1
"""


async def _container_pid(container: str, preferred_runtime: str) -> int:
    binary = runner.container_runtime_binary(preferred_runtime)
    if not binary:
        raise HTTPException(503, "no container runtime (docker/podman) found")
    proc = await asyncio.create_subprocess_exec(
        binary,
        "inspect",
        "-f",
        "{{.State.Pid}}",
        container,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    text = out.decode().strip()
    if proc.returncode != 0 or not text.isdigit() or text == "0":
        raise HTTPException(409, f"container {container} is not running: {err.decode().strip()}")
    return int(text)


def _topology_path(session_id: str | None, topology: str | None) -> str:
    if session_id:
        return common.session_path(session_id)
    if topology:
        # Lets a copied `curl … | wireshark` command outlive the browser
        # session; still confined to the configured workspaces.
        return str(common.resolve_workspace_path(topology))
    raise HTTPException(400, "pass sessionId or topology")


async def _running_container(path: str, node: str) -> tuple[str, str]:
    """(container name, preferred runtime) for a running clab node of the lab at ``path``."""
    from app.contract import commands

    try:
        status = await runner.status_for(path)
    except (runner.NetlabError, runner.NetlabNotInstalled) as exc:
        raise HTTPException(409, f"lab status unavailable: {exc}") from exc
    info = ((status or {}).get("nodes") or {}).get(node) if isinstance(status, dict) else None
    if not isinstance(info, dict):
        raise HTTPException(404, f"node {node!r} is not part of the running lab")
    if info.get("provider") != "clab":
        raise HTTPException(409, f"node {node!r} is not a container; capture on VMs is not supported")
    return str(info.get("provider_name") or node), runtime_state.clab_runtime(commands.load_topology(path))


@router.get("/capture/pcap")
async def capture_pcap(
    node: str,
    interface: str,
    seconds: float = Query(10, ge=0, le=MAX_SECONDS, description="0 = until the client disconnects"),
    maxPackets: int = Query(100_000, ge=1, le=MAX_PACKETS),
    sessionId: str | None = None,
    topology: str | None = Query(None, description="topology file path, instead of sessionId"),
):
    """Capture on one node interface and stream it as a pcap file."""
    if not _IFACE_RE.fullmatch(interface):
        raise HTTPException(400, f"invalid interface name {interface!r}")
    container, preferred_runtime = await _running_container(_topology_path(sessionId, topology), node)
    pid = await _container_pid(container, preferred_runtime)
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        _CAPTURE_SCRIPT,
        str(pid),
        interface,
        str(seconds or MAX_SECONDS),
        str(maxPackets),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdout is not None and proc.stderr is not None
    # The header arrives only once the socket is open — so a bad interface or
    # missing privileges become a proper HTTP error instead of an empty file.
    header = await proc.stdout.read(24)
    if len(header) < 24:
        await proc.wait()
        detail = (await proc.stderr.read()).decode(errors="replace").strip()
        raise HTTPException(502, detail or f"capture helper exited with {proc.returncode}")

    async def stream():
        try:
            yield header
            while chunk := await proc.stdout.read(65536):
                yield chunk
        finally:
            if proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
            await proc.wait()

    stamp = time.strftime("%Y%m%d-%H%M%S")
    filename = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{node}-{interface}-{stamp}.pcap")
    return StreamingResponse(
        stream(),
        media_type="application/vnd.tcpdump.pcap",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', **common.SSE_HEADERS},
    )
