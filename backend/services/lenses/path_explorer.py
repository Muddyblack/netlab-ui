"""Intended reachability / path explorer.

Given a source node, destination node, address family and VRF, walk the
*transformed* topology to derive the expected forwarding path — or explain the
blockage. This is intent, not live state: it reflects how netlab wired and
addressed the lab (interfaces, subnets, IGP, VRFs), not a deployed RIB.

Adjacency is built from resolved interface neighbors: two nodes are adjacent for
a (family, vrf) pair when they share a link on which both endpoints carry an
address in that family and both interfaces live in the same VRF. Shortest path
is Dijkstra weighted by IGP cost where available.
"""

from __future__ import annotations

import heapq
import ipaddress
from collections import OrderedDict
from typing import Any

from services.lenses._helpers import as_dict as _dict
from services.lenses._helpers import as_list as _list

DEFAULT_VRF = "default"
_FAMILY_LABEL = {"ipv4": "IPv4", "ipv6": "IPv6"}
_INF = float("inf")

# Memoized adjacency graphs keyed by (source-YAML hash, family, vrf).
# ``runner.create`` hands the topology's content hash alongside the snapshot, so
# repeated Trace clicks on unchanged YAML reuse a built graph instead of walking
# every interface + neighbor again. Keying on *content* (not object identity)
# means an in-place snapshot mutation can never surface a stale path — a changed
# topology hashes differently and misses. LRU-bounded; no key ⇒ no caching.
_GRAPH_CACHE_LIMIT = 8
_graph_cache: OrderedDict[tuple[str, str, str], dict[str, list[dict[str, Any]]]] = OrderedDict()


def _iface_address(interface: dict[str, Any], family: str) -> str | None:
    value = interface.get(family)
    return value if isinstance(value, str) else None


def _iface_vrf(interface: dict[str, Any]) -> str:
    vrf = interface.get("vrf")
    return str(vrf) if vrf else DEFAULT_VRF


def _subnet(address: str | None) -> str | None:
    if not address:
        return None
    try:
        return str(ipaddress.ip_interface(address).network)
    except ValueError:
        return None


def _iface_protocol(interface: dict[str, Any]) -> str:
    ospf = interface.get("ospf")
    if isinstance(ospf, dict) and not ospf.get("passive"):
        return "ospf"
    isis = interface.get("isis")
    if isinstance(isis, dict) and not isis.get("passive"):
        return "isis"
    return "connected"


def _iface_cost(interface: dict[str, Any]) -> int:
    ospf = _dict(interface.get("ospf"))
    if isinstance(ospf.get("cost"), int):
        return max(1, ospf["cost"])
    isis = _dict(interface.get("isis"))
    if isinstance(isis.get("metric"), int):
        return max(1, isis["metric"])
    return 1


def _edge_id(interface: dict[str, Any]) -> list[str]:
    link_index = interface.get("linkindex")
    if isinstance(link_index, int) and link_index >= 1:
        return [f"e{link_index - 1}"]
    return []


def available_vrfs(transformed: dict[str, Any]) -> list[str]:
    vrfs = {DEFAULT_VRF}
    for raw_node in _dict(transformed.get("nodes")).values():
        for raw_iface in _list(_dict(raw_node).get("interfaces")):
            vrfs.add(_iface_vrf(_dict(raw_iface)))
    return sorted(vrfs)


def build_reachability(transformed: dict[str, Any]) -> dict[str, Any]:
    """Lightweight picker data for the bundle (nodes + families + vrfs)."""
    nodes = _dict(transformed.get("nodes"))
    families: set[str] = set()
    for raw_node in nodes.values():
        for raw_iface in _list(_dict(raw_node).get("interfaces")):
            interface = _dict(raw_iface)
            for family in ("ipv4", "ipv6"):
                if _iface_address(interface, family):
                    families.add(family)
    return {
        "available": len(nodes) >= 2,
        "families": [family for family in ("ipv4", "ipv6") if family in families],
        "vrfs": available_vrfs(transformed),
        "nodes": sorted(str(name) for name in nodes),
    }


def _build_graph(transformed: dict[str, Any], family: str, vrf: str) -> dict[str, list[dict[str, Any]]]:
    graph: dict[str, list[dict[str, Any]]] = {}
    nodes = _dict(transformed.get("nodes"))
    for node_name, raw_node in nodes.items():
        node_name = str(node_name)
        graph.setdefault(node_name, [])
        for raw_iface in _list(_dict(raw_node).get("interfaces")):
            interface = _dict(raw_iface)
            local_address = _iface_address(interface, family)
            if not local_address or _iface_vrf(interface) != vrf:
                continue
            for raw_neighbor in _list(interface.get("neighbors")):
                neighbor = _dict(raw_neighbor)
                neighbor_node = str(neighbor.get("node") or "")
                neighbor_address = _iface_address(neighbor, family)
                if not neighbor_node or neighbor_node not in nodes or not neighbor_address:
                    continue
                graph[node_name].append(
                    {
                        "to": neighbor_node,
                        "egressInterface": str(interface.get("ifname") or ""),
                        "egressAddress": local_address,
                        "ingressInterface": str(neighbor.get("ifname") or ""),
                        "ingressAddress": neighbor_address,
                        "subnet": _subnet(local_address),
                        "protocol": _iface_protocol(interface),
                        "cost": _iface_cost(interface),
                        "edgeIds": _edge_id(interface),
                    }
                )
    return graph


def _graph_for(
    transformed: dict[str, Any], family: str, vrf: str, snapshot_key: str | None
) -> dict[str, list[dict[str, Any]]]:
    """Cached ``_build_graph``: reuse the adjacency for repeated traces on the
    same (topology content, family, vrf). Falls back to an uncached build when
    no content key is available."""
    if not snapshot_key:
        return _build_graph(transformed, family, vrf)
    key = (snapshot_key, family, vrf)
    cached = _graph_cache.get(key)
    if cached is not None:
        _graph_cache.move_to_end(key)
        return cached
    graph = _build_graph(transformed, family, vrf)
    _graph_cache[key] = graph
    _graph_cache.move_to_end(key)
    while len(_graph_cache) > _GRAPH_CACHE_LIMIT:
        _graph_cache.popitem(last=False)
    return graph


def _node_has_family_in_vrf(transformed: dict[str, Any], node: str, family: str, vrf: str) -> bool:
    raw_node = _dict(_dict(transformed.get("nodes")).get(node))
    loopback = _dict(raw_node.get("loopback"))
    if _iface_address(loopback, family) and vrf == DEFAULT_VRF:
        return True
    for raw_iface in _list(raw_node.get("interfaces")):
        interface = _dict(raw_iface)
        if _iface_address(interface, family) and _iface_vrf(interface) == vrf:
            return True
    return False


def _dijkstra(graph: dict[str, list[dict[str, Any]]], source: str, target: str) -> list[dict[str, Any]] | None:
    heap: list[tuple[int, str]] = [(0, source)]
    best: dict[str, int] = {source: 0}
    # (from-node, edge) references — no per-relaxation dict copy; the enriched
    # ``{**edge, "from": ...}`` hops are materialized only for the final path.
    prev: dict[str, tuple[str, dict[str, Any]]] = {}
    while heap:
        dist, node = heapq.heappop(heap)
        if node == target:
            break
        if dist > best.get(node, _INF):
            continue
        for edge in graph.get(node, []):
            nxt = edge["to"]
            new_cost = dist + edge["cost"]
            if new_cost < best.get(nxt, _INF):
                best[nxt] = new_cost
                prev[nxt] = (node, edge)
                heapq.heappush(heap, (new_cost, nxt))
    if target not in prev and target != source:
        return None
    hops: list[dict[str, Any]] = []
    cursor = target
    while cursor != source:
        entry = prev.get(cursor)
        if entry is None:
            return None
        from_node, edge = entry
        hops.append({**edge, "from": from_node})
        cursor = from_node
    hops.reverse()
    return hops


def compute_path(
    transformed: dict[str, Any],
    *,
    source: str,
    target: str,
    family: str = "ipv4",
    vrf: str = DEFAULT_VRF,
    snapshot_key: str | None = None,
) -> dict[str, Any]:
    nodes = _dict(transformed.get("nodes"))
    base = {
        "source": source,
        "target": target,
        "family": family,
        "vrf": vrf,
        "reachable": False,
        "hopCount": 0,
        "summary": "",
        "protocols": [],
        "hops": [],
        "blockage": None,
        "explanation": [],
        "objectRefs": [],
    }
    if source not in nodes or target not in nodes:
        return {**base, "blockage": "unknown-node", "explanation": ["Pick two nodes that exist in this topology."]}
    if source == target:
        return {
            **base,
            "reachable": True,
            "summary": f"{source} is the source and destination.",
            "objectRefs": [f"node:{source}"],
        }
    if not _node_has_family_in_vrf(transformed, target, family, vrf):
        return {
            **base,
            "blockage": "no-address",
            "explanation": [f"{target} has no {_FAMILY_LABEL.get(family, family)} interface in VRF {vrf}."],
            "objectRefs": [f"node:{target}"],
        }

    graph = _graph_for(transformed, family, vrf, snapshot_key)
    hops = _dijkstra(graph, source, target)
    if hops is None:
        explanation = [f"No {_FAMILY_LABEL.get(family, family)} path from {source} to {target} in VRF {vrf}."]
        if not _node_has_family_in_vrf(transformed, source, family, vrf):
            explanation.append(f"{source} has no {_FAMILY_LABEL.get(family, family)} interface in VRF {vrf}.")
        else:
            explanation.append("The two nodes are not connected through a shared subnet in this VRF.")
        return {
            **base,
            "blockage": "no-path",
            "explanation": explanation,
            "objectRefs": [f"node:{source}", f"node:{target}"],
        }

    hop_rows: list[dict[str, Any]] = []
    protocols: list[str] = []
    object_refs: set[str] = {f"node:{source}", f"node:{target}"}
    for index, hop in enumerate(hops, start=1):
        protocol = hop["protocol"]
        if protocol not in protocols:
            protocols.append(protocol)
        object_refs.add(f"node:{hop['from']}")
        object_refs.add(f"node:{hop['to']}")
        object_refs.update(hop["edgeIds"])
        hop_rows.append(
            {
                "order": index,
                "fromNode": hop["from"],
                "toNode": hop["to"],
                "egressInterface": hop["egressInterface"],
                "egressAddress": hop["egressAddress"],
                "ingressInterface": hop["ingressInterface"],
                "ingressAddress": hop["ingressAddress"],
                "subnet": hop["subnet"],
                "protocol": protocol,
                "cost": hop["cost"],
                "edgeIds": hop["edgeIds"],
                "objectRefs": [f"node:{hop['from']}", f"node:{hop['to']}", *hop["edgeIds"]],
            }
        )

    hop_count = len(hop_rows)
    if hop_count == 1 and hop_rows[0]["protocol"] == "connected":
        summary = f"Directly connected on {hop_rows[0]['subnet']}."
    else:
        summary = f"Reachable in {hop_count} hop{'s' if hop_count != 1 else ''} via {', '.join(protocols)}."

    explanation: list[str] = []
    # Multi-hop paths that rely on 'connected' interfaces alone need static or
    # dynamic routing to actually forward — surface that as intent guidance.
    routed = [row for row in hop_rows if row["protocol"] in {"ospf", "isis"}]
    if hop_count > 1 and not routed:
        explanation.append("No IGP is active along this path — forwarding depends on static or default routes.")

    return {
        **base,
        "reachable": True,
        "hopCount": hop_count,
        "summary": summary,
        "protocols": protocols,
        "hops": hop_rows,
        "explanation": explanation,
        "objectRefs": sorted(object_refs),
    }
