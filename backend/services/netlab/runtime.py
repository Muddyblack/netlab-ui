"""Translate live netlab/container state into clab-ui's public runtime contract."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from services.model.topology import Topology
from services.netlab import runner

_counter_cache: dict[tuple[str, str], tuple[float, int, int, int, int]] = {}


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
    result: dict[str, Any] = {
        "rxBytes": rx_bytes,
        "txBytes": tx_bytes,
        "rxPackets": rx_packets,
        "txPackets": tx_packets,
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
            }
        )
    _counter_cache[(container, iface)] = (now, rx_bytes, tx_bytes, rx_packets, tx_packets)
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
        if info.get("provider") == "clab" and state == "running":
            raw_interfaces = await runner.container_interfaces(provider_name, preferred_runtime)
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
            "interfaces": [_interface(provider_name, item, now) for item in raw_interfaces],
        }

    return await asyncio.gather(
        *(one(str(name), info if isinstance(info, dict) else {}) for name, info in nodes_status.items())
    )
