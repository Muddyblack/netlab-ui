"""Translate live netlab/container state into clab-ui's public runtime contract."""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from typing import Any

from services.model.topology import Topology
from services.netlab import runner

_counter_cache: dict[tuple[str, str], tuple[float, int, int, int, int, int]] = {}


def clab_runtime(topo: Topology) -> str:
    providers = topo.defaults.get("providers") if isinstance(topo.defaults, dict) else None
    clab = providers.get("clab") if isinstance(providers, dict) else None
    return str(clab.get("runtime") or "") if isinstance(clab, dict) else ""


def _stats(container: str, iface: str, raw: dict[str, Any], now: float) -> dict[str, Any]:
    counters = raw.get("stats64") or raw.get("stats") or {}
    rx = counters.get("rx") or {}
    tx = counters.get("tx") or {}
    rx_bytes, tx_bytes = int(rx.get("bytes") or 0), int(tx.get("bytes") or 0)
    rx_packets, tx_packets = int(rx.get("packets") or 0), int(tx.get("packets") or 0)
    problems = {
        "rxErrors": int(rx.get("errors") or 0),
        "txErrors": int(tx.get("errors") or 0),
        "rxDropped": int(rx.get("dropped") or 0),
        "txDropped": int(tx.get("dropped") or 0),
    }
    problem_total = sum(problems.values())
    result: dict[str, Any] = {
        "rxBytes": rx_bytes,
        "txBytes": tx_bytes,
        "rxPackets": rx_packets,
        "txPackets": tx_packets,
        **problems,
    }
    previous = _counter_cache.get((container, iface))
    if previous and now > previous[0]:
        interval = now - previous[0]
        result.update(
            {
                "rxBps": max(0, round((rx_bytes - previous[1]) * 8 / interval)),
                "txBps": max(0, round((tx_bytes - previous[2]) * 8 / interval)),
                "rxPps": max(0, round((rx_packets - previous[3]) / interval)),
                "txPps": max(0, round((tx_packets - previous[4]) / interval)),
                "statsIntervalSeconds": interval,
                "newErrors": max(0, problem_total - previous[5]),
            }
        )
    _counter_cache[(container, iface)] = (now, rx_bytes, tx_bytes, rx_packets, tx_packets, problem_total)
    return result


_NETEM_LINE = re.compile(r"^qdisc netem \S+ dev (?P<dev>\S+)(?P<rest>.*)$")
_TIME = r"[\d.]+(?:us|ms|s)"
_RATE_UNITS = {"bit": 0.001, "kbit": 1, "mbit": 1000, "gbit": 1_000_000}


def _kbit(rate: str) -> str:
    match = re.fullmatch(r"([\d.]+)([KMG]?bit)", rate, re.IGNORECASE)
    if not match:
        return rate
    value = float(match.group(1)) * _RATE_UNITS[match.group(2).lower()]
    return str(round(value))


def parse_netem(qdisc_text: str) -> dict[str, dict[str, str]]:
    """Per interface, the netem impairments in `tc qdisc show` output, in the
    units `containerlab tools netem set` takes (delay/jitter with a time
    unit, loss/corruption in percent, rate in kbit/s)."""
    result: dict[str, dict[str, str]] = {}
    for line in qdisc_text.splitlines():
        match = _NETEM_LINE.match(line.strip())
        if not match:
            continue
        rest = match.group("rest")
        state: dict[str, str] = {}
        if delay := re.search(rf"\bdelay ({_TIME})(?:\s+({_TIME}))?", rest):
            state["delay"] = delay.group(1)
            if delay.group(2):
                state["jitter"] = delay.group(2)
        if loss := re.search(r"\bloss (?:random )?([\d.]+)%", rest):
            state["loss"] = loss.group(1)
        if rate := re.search(r"\brate (\S+)", rest):
            state["rate"] = _kbit(rate.group(1))
        if corrupt := re.search(r"\bcorrupt ([\d.]+)%", rest):
            state["corruption"] = corrupt.group(1)
        result[match.group("dev")] = state
    return result


def _interface(container: str, raw: dict[str, Any], now: float) -> dict[str, Any]:
    name = str(raw.get("ifname") or "")
    operstate = str(raw.get("operstate") or "unknown").lower()
    if operstate == "unknown" and "UP" in (raw.get("flags") or []):
        operstate = "up"
    return {
        "name": name,
        "alias": str(raw.get("ifalias") or name),
        "label": name,
        "mac": str(raw.get("address") or ""),
        "mtu": int(raw.get("mtu") or 0),
        "state": operstate,
        "type": str(raw.get("link_type") or raw.get("linkinfo", {}).get("info_kind") or ""),
        "ifIndex": int(raw.get("ifindex") or 0),
        "stats": _stats(container, name, raw, now),
    }


async def collect(topology_path: str | Path, topo: Topology) -> list[dict[str, Any]]:
    status = await runner.status_for(topology_path)
    lab = status if isinstance(status, dict) and "nodes" in status else {}
    nodes_status = lab.get("nodes") if isinstance(lab, dict) else {}
    if not isinstance(nodes_status, dict):
        return []
    preferred_runtime = clab_runtime(topo)

    async def one(node_name: str, info: dict[str, Any]) -> dict[str, Any]:
        provider_name = str(info.get("provider_name") or node_name)
        # Canonical state, not docker's verbatim "Up 2 minutes" — clab-ui and
        # the interface probe below both compare against "running".
        state = runner.normalize_node_state(info.get("status"))
        raw_interfaces: list[dict[str, Any]] = []
        netem: dict[str, dict[str, str]] = {}
        if info.get("provider") == "clab" and state == "running":
            raw_interfaces, qdisc_text = await runner.container_link_snapshot(provider_name, preferred_runtime)
            netem = parse_netem(qdisc_text)
        now = time.monotonic()
        source_node = topo.node(node_name)
        return {
            "name": provider_name,
            "nodeName": node_name,
            "labName": topo.name,
            "state": state,
            "kind": source_node.device if source_node and source_node.device else str(info.get("device") or ""),
            "image": str(info.get("image") or ""),
            "ipv4Address": str(info.get("mgmt") or ""),
            "ipv6Address": "",
            "interfaces": [
                {**_interface(provider_name, item, now), "netemState": netem.get(str(item.get("ifname") or ""))}
                for item in raw_interfaces
            ],
        }

    return await asyncio.gather(
        *(one(str(name), info if isinstance(info, dict) else {}) for name, info in nodes_status.items())
    )
