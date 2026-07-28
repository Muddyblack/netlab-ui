"""Netlab-native link authoring helpers used by the visual links panel."""

from __future__ import annotations

from typing import Literal

from services.model.topology import Link, Topology

LinkKind = Literal["stub", "lan", "uplink", "bridge-type"]


def _require_nodes(topo: Topology, node_names: list[str], minimum: int, maximum: int | None = None) -> list[str]:
    names = list(dict.fromkeys(name.strip() for name in node_names if name.strip()))
    if len(names) < minimum or (maximum is not None and len(names) > maximum):
        if maximum == minimum:
            raise ValueError(f"select exactly {minimum} node{'s' if minimum != 1 else ''}")
        raise ValueError(f"select at least {minimum} nodes")

    existing = {node.name for node in topo.nodes}
    missing = [name for name in names if name not in existing]
    if missing:
        raise ValueError(f"unknown node{'s' if len(missing) != 1 else ''}: {', '.join(missing)}")
    return names


def add_stub(topo: Topology, node_names: list[str], name: str = "") -> None:
    nodes = _require_nodes(topo, node_names, 1, 1)
    attrs = {"name": name.strip()} if name.strip() else {}
    topo.links.append(Link(endpoints=nodes, attrs=attrs))


def add_lan(topo: Topology, node_names: list[str], name: str = "", bridge: str = "") -> None:
    nodes = _require_nodes(topo, node_names, 2)
    attrs: dict[str, object] = {"type": "lan"}
    if name.strip():
        attrs["name"] = name.strip()
    if bridge.strip():
        attrs["bridge"] = bridge.strip()
    topo.links.append(Link(endpoints=nodes, attrs=attrs))


def add_uplink(topo: Topology, node_names: list[str], host_interface: str, name: str = "") -> None:
    nodes = _require_nodes(topo, node_names, 1, 1)
    interface = host_interface.strip()
    if not interface:
        raise ValueError("host interface is required")
    attrs: dict[str, object] = {"clab": {"uplink": interface}}
    if name.strip():
        attrs["name"] = name.strip()
    topo.links.append(Link(endpoints=nodes, attrs=attrs))


def set_bridge_type(topo: Topology, bridge_type: str) -> None:
    if bridge_type not in {"bridge", "ovs-bridge"}:
        raise ValueError("bridge type must be 'bridge' or 'ovs-bridge'")
    providers = topo.defaults.setdefault("providers", {})
    if not isinstance(providers, dict):
        raise ValueError("defaults.providers must be a mapping")
    clab = providers.setdefault("clab", {})
    if not isinstance(clab, dict):
        raise ValueError("defaults.providers.clab must be a mapping")
    clab["bridge_type"] = bridge_type


def apply(
    topo: Topology,
    kind: LinkKind,
    node_names: list[str],
    *,
    name: str = "",
    bridge: str = "",
    host_interface: str = "",
    bridge_type: str = "bridge",
) -> None:
    if kind == "stub":
        add_stub(topo, node_names, name)
    elif kind == "lan":
        add_lan(topo, node_names, name, bridge)
    elif kind == "uplink":
        add_uplink(topo, node_names, host_interface, name)
    elif kind == "bridge-type":
        set_bridge_type(topo, bridge_type)
    else:
        raise ValueError(f"unsupported netlab link kind: {kind}")
