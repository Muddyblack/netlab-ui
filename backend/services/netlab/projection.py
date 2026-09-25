"""A canvas projection straight from netlab's transformed topology.

The canvas normally renders the ``clab.yml`` that ``netlab create`` writes.
A lab whose primary provider is not containerlab (libvirt VMs, external
devices) has no ``clab.yml``, but the transform itself succeeded and knows
everything the canvas needs: every node with its device and management
address, every link with netlab's real interface names (``Ethernet1`` on EOS,
``GigabitEthernet0/1`` on IOS…). This module reshapes that into the same
clab-style dict, so the canvas keeps one code path for all providers.
"""

from __future__ import annotations

from typing import Any


def node_provider(node: dict[str, Any], transformed: dict[str, Any]) -> str:
    """A node's provider: its own, else the lab's primary one."""
    return str(node.get("provider") or transformed.get("provider") or "clab")


def providers_in(transformed: dict[str, Any]) -> set[str]:
    nodes = transformed.get("nodes") if isinstance(transformed.get("nodes"), dict) else {}
    return {node_provider(node, transformed) for node in nodes.values() if isinstance(node, dict)}


def _node_body(node: dict[str, Any], transformed: dict[str, Any]) -> dict[str, Any]:
    provider = node_provider(node, transformed)
    mgmt = node.get("mgmt") if isinstance(node.get("mgmt"), dict) else {}
    body: dict[str, Any] = {
        "kind": str(node.get("device") or ""),
        "image": str(node.get("box") or node.get("image") or ""),
        "labels": {"netlab-provider": provider},
    }
    if mgmt.get("ipv4"):
        body["mgmt-ipv4"] = str(mgmt["ipv4"])
    return body


def from_transformed(transformed: dict[str, Any]) -> dict[str, Any]:
    """clab-shaped ``{"name", "topology": {"nodes", "links"}}`` for any provider.

    Point-to-point links become one endpoint pair. A multi-access link (three
    or more nodes) becomes a bridge node named after netlab's bridge, with one
    link per attached node — how the clab projection draws LANs too. Stub
    links with a single node have nothing to connect and are left out.
    """
    raw_nodes = transformed.get("nodes") if isinstance(transformed.get("nodes"), dict) else {}
    nodes = {str(name): _node_body(node, transformed) for name, node in raw_nodes.items() if isinstance(node, dict)}
    links: list[dict[str, Any]] = []
    for index, link in enumerate(transformed.get("links") or [], start=1):
        if not isinstance(link, dict):
            continue
        ends = [
            f"{iface.get('node')}:{iface.get('ifname') or ''}"
            for iface in link.get("interfaces") or []
            if isinstance(iface, dict) and iface.get("node") in nodes
        ]
        if len(ends) == 2:
            links.append({"endpoints": ends})
        elif len(ends) > 2:
            bridge = str(link.get("bridge") or f"{transformed.get('name', 'lab')}_{index}")
            nodes.setdefault(bridge, {"kind": "bridge", "labels": {"netlab-provider": "bridge"}})
            links.extend({"endpoints": [end, f"{bridge}:"]} for end in ends)
    return {"name": transformed.get("name"), "topology": {"nodes": nodes, "links": links}}
