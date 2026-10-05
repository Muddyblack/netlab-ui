"""Packet captures for an attached agent: take one on a node interface, read it back.

A capture is the same pcap stream the UI's "Download pcap" gives (``app/lab/pcap.py``),
saved in ``<lab>/captures/`` so the user can open it in Wireshark afterwards, and decoded by
:mod:`services.netlab.pcap_decode` into protocol summaries, conversations and findings.
Capturing only listens on one interface; it never changes the lab. Packet text comes
from the lab's traffic, so it is returned marked untrusted.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from services.assistant.tools import ToolError, _cap, _lab_name, _session, _untrusted
from services.netlab import pcap_decode

MAX_SECONDS = 60
MAX_PACKETS = 5000
MAX_FILE_BYTES = 32 * 1024 * 1024
DEFAULT_LINES = 40
MAX_LINES = 200

_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.pcap$")
_SAFE = re.compile(r"[^A-Za-z0-9_.-]")


def _captures_dir(session: Any) -> Path:
    return Path(session.topology_path).parent / "captures"


def _find(session: Any, name: str) -> Path:
    if not _FILE_RE.fullmatch(name):
        raise ToolError(f"{name!r} is not a capture file name -- read_capture() without `file` lists them")
    path = _captures_dir(session) / name
    if not path.is_file():
        raise ToolError(f"no capture {name!r} -- read_capture() without `file` lists them")
    return path


def _describe(path: Path, packets: list[pcap_decode.Packet], truncated: bool) -> dict[str, Any]:
    result: dict[str, Any] = {"file": path.name, "path": str(path), "size": path.stat().st_size}
    result["summary"] = pcap_decode.summarize(packets)
    if truncated:
        result["note"] = f"only the first {pcap_decode.MAX_PACKETS} packets were decoded"
    return result


def _lines(packets: list[pcap_decode.Packet], flt: str, offset: int, limit: int) -> dict[str, Any]:
    chosen = [p for p in packets if pcap_decode.matches(p, flt)] if flt else packets
    page = chosen[offset : offset + limit]
    out: dict[str, Any] = {"matching": len(chosen), "shown": len(page), "offset": offset}
    out["packets"] = _untrusted(_cap("\n".join(p.line() for p in page))) if page else "(no packets match)"
    if offset + limit < len(chosen):
        out["more"] = f"call again with offset={offset + limit} for the next {limit}"
    return out


async def capture_packets(
    node: str,
    interface: str,
    seconds: float = 5,
    max_packets: int = 2000,
    filter: str = "",
    lines: int = DEFAULT_LINES,
    lab: str | None = None,
) -> dict[str, Any]:
    """Capture on a running node's interface and decode it: saved to ``captures/``, with a
    protocol summary, the busiest conversations, findings (resets, unanswered ARP, BGP
    notifications...) and the first matching packets."""
    from app.lab import pcap

    session = _session(lab)
    seconds = max(1.0, min(float(seconds), MAX_SECONDS))
    max_packets = max(1, min(int(max_packets), MAX_PACKETS))
    try:
        proc, header = await pcap.start_capture(session.topology_path, node, interface, seconds, max_packets)
    except HTTPException as exc:
        raise ToolError(f"cannot capture on {node} {interface}: {exc.detail}") from exc
    assert proc.stdout is not None
    data = bytearray(header)
    try:
        async with asyncio.timeout(seconds + 10):
            while chunk := await proc.stdout.read(65536):
                data += chunk
                if len(data) > MAX_FILE_BYTES:
                    break
    except TimeoutError:
        pass
    finally:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
        await proc.wait()
    directory = _captures_dir(session)
    directory.mkdir(exist_ok=True)
    path = directory / _SAFE.sub("_", f"{node}-{interface}-{time.strftime('%Y%m%d-%H%M%S')}.pcap")
    path.write_bytes(bytes(data))
    packets, truncated = pcap_decode.read_packets(bytes(data))
    result = {
        "lab": _lab_name(session),
        "node": node,
        "interface": interface,
        "seconds": seconds,
        **_describe(path, packets, truncated),
    }
    if not packets:
        result["hint"] = (
            "no packets arrived: nothing crossed that interface in this time (try longer, or trigger traffic)"
        )
        return result
    return {**result, **_lines(packets, filter, 0, max(1, min(lines, MAX_LINES)))}


async def read_capture(
    file: str = "",
    filter: str = "",
    offset: int = 0,
    limit: int = DEFAULT_LINES,
    packet: int = 0,
    lab: str | None = None,
) -> dict[str, Any]:
    """Read a saved capture. Without ``file``: the captures in the lab's ``captures/``. With
    ``file``: summary plus decoded packet lines (``filter``: `bgp`, `host 10.0.0.1`, `port 179`,
    `vlan 10`, `not arp`, or a word from the line; ``offset``/``limit`` page). With ``packet``:
    one packet's layers and hex dump, to extract exactly what was on the wire."""
    session = _session(lab)
    if not file:
        directory = _captures_dir(session)
        found = (
            sorted(directory.glob("*.pcap"), key=lambda p: p.stat().st_mtime, reverse=True)
            if directory.is_dir()
            else []
        )
        return {"captures": [{"file": p.name, "size": p.stat().st_size} for p in found[:50]]}
    path = _find(session, file)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ToolError(f"{file} is larger than {MAX_FILE_BYTES // 2**20} MB -- open it in Wireshark")
    try:
        packets, truncated = pcap_decode.read_packets(path.read_bytes())
    except pcap_decode.PcapError as exc:
        raise ToolError(str(exc)) from exc
    if packet:
        if not 1 <= packet <= len(packets):
            raise ToolError(f"packet {packet} is outside 1..{len(packets)}")
        return {"file": file, "packet": _untrusted(_cap(json.dumps(pcap_decode.detail(packets[packet - 1]), indent=1)))}
    return {
        **_describe(path, packets, truncated),
        **_lines(packets, filter, max(0, offset), max(1, min(limit, MAX_LINES))),
    }
