"""Build the Service & Tenant explorer view (VLAN / VRF / VXLAN / EVPN).

Netlab resolves L2/L3 services into the transformed topology: ``vlans`` (with
ids, VNIs, IRB mode, EVPN EVI/RD/RT), ``vrfs`` (route distinguishers and route
targets), ``vxlan`` (VTEP membership) and ``evpn`` (overlay sessions). This
module normalizes those into selectable *services* the UI can "follow" —
isolating every node and link that participates in a chosen VLAN or tenant.
"""

from __future__ import annotations

from typing import Any

from services.lenses._helpers import as_dict as _dict
from services.lenses._helpers import as_list as _list
from services.lenses._helpers import edge_ids as _edge_ids


def _color_key(kind: str, name: str, discriminator: Any = None) -> str:
    return f"{kind}:{discriminator if discriminator is not None else name}"


def _link_vlans(interface: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return (access_vlans, trunk_vlans) named on one physical endpoint."""
    vlan = _dict(interface.get("vlan"))
    access = [str(vlan["access"])] if vlan.get("access") else []
    trunk_raw = vlan.get("trunk")
    trunk = [str(name) for name in trunk_raw] if isinstance(trunk_raw, dict | list) else []
    return access, trunk


def _vlan_edges(transformed: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Map each VLAN name to the physical edges that carry it, with mode."""
    edges: dict[str, list[dict[str, Any]]] = {}
    for fallback_index, raw_link in enumerate(_list(transformed.get("links")), start=1):
        link = _dict(raw_link)
        endpoints = [_dict(ep) for ep in _list(link.get("interfaces")) if _dict(ep).get("node")]
        link_index = int(link.get("linkindex") or fallback_index)
        edge_ids = _edge_ids(link_index, endpoints)
        nodes = [str(ep.get("node")) for ep in endpoints]
        for ep in endpoints:
            access, trunk = _link_vlans(ep)
            for name in access:
                edges.setdefault(name, []).append({"edgeIds": edge_ids, "nodes": nodes, "mode": "access"})
            for name in trunk:
                edges.setdefault(name, []).append({"edgeIds": edge_ids, "nodes": nodes, "mode": "trunk"})
    return edges


def build_service_explorer(transformed: dict[str, Any]) -> dict[str, Any]:
    nodes = _dict(transformed.get("nodes"))
    top_vlans = _dict(transformed.get("vlans"))
    top_vrfs = _dict(transformed.get("vrfs"))
    top_vxlan = _dict(transformed.get("vxlan"))
    top_evpn = _dict(transformed.get("evpn"))
    vlan_edges = _vlan_edges(transformed)

    # ── VLANs ────────────────────────────────────────────────────────────────
    vlans: list[dict[str, Any]] = []
    for name, raw in top_vlans.items():
        vlan = _dict(raw)
        member_nodes: set[str] = set()
        svi_nodes: set[str] = set()
        vni: int | None = vlan.get("vni") if isinstance(vlan.get("vni"), int) else None
        evpn_info: dict[str, Any] | None = None
        for node_name, raw_node in nodes.items():
            node_vlan = _dict(_dict(raw_node).get("vlans")).get(str(name))
            if node_vlan is not None:
                member_nodes.add(str(node_name))
                node_vlan = _dict(node_vlan)
                if isinstance(node_vlan.get("vni"), int):
                    vni = node_vlan["vni"]
                if node_vlan.get("evpn") and evpn_info is None:
                    evpn = _dict(node_vlan["evpn"])
                    evpn_info = {
                        "evi": evpn.get("evi"),
                        "rd": str(evpn.get("rd")) if evpn.get("rd") else None,
                        "importTargets": [str(rt) for rt in _list(evpn.get("import"))],
                        "exportTargets": [str(rt) for rt in _list(evpn.get("export"))],
                    }
        for neighbor in _list(vlan.get("neighbors")):
            node_name = _dict(neighbor).get("node")
            if node_name:
                member_nodes.add(str(node_name))
        edges = vlan_edges.get(str(name), [])
        edge_ids = sorted({eid for entry in edges for eid in entry["edgeIds"]})
        for entry in edges:
            member_nodes.update(entry["nodes"])
        # Nodes with an SVI (mode irb/route) terminate the VLAN at L3.
        for node_name, raw_node in nodes.items():
            node_vlan = _dict(_dict(_dict(raw_node).get("vlans")).get(str(name)))
            if node_vlan.get("mode") in {"irb", "route"}:
                svi_nodes.add(str(node_name))
        object_refs = [f"vlan:{name}"] + [f"node:{node}" for node in sorted(member_nodes)]
        vlans.append(
            {
                "name": str(name),
                "id": vlan.get("id") if isinstance(vlan.get("id"), int) else None,
                "vni": vni,
                "mode": str(vlan.get("mode") or "bridge"),
                "prefix": str(_dict(vlan.get("prefix")).get("ipv4")) if _dict(vlan.get("prefix")).get("ipv4") else None,
                "vrf": str(vlan.get("vrf")) if vlan.get("vrf") else None,
                "evpn": evpn_info,
                "nodeIds": sorted(member_nodes),
                "sviNodeIds": sorted(svi_nodes),
                "physicalEdgeIds": edge_ids,
                "edges": [{"edgeIds": e["edgeIds"], "mode": e["mode"], "nodes": e["nodes"]} for e in edges],
                "colorKey": _color_key("vlan", str(name), vlan.get("id")),
                "objectRefs": object_refs,
            }
        )

    # ── VRFs (tenants) ───────────────────────────────────────────────────────
    vrfs: list[dict[str, Any]] = []
    for name, raw in top_vrfs.items():
        vrf = _dict(raw)
        member_nodes = {
            str(node_name) for node_name, raw_node in nodes.items() if str(name) in _dict(_dict(raw_node).get("vrfs"))
        }
        vrf_vlans = sorted(v["name"] for v in vlans if v["vrf"] == str(name))
        evpn_transit = None
        for node_name in member_nodes:
            node_vrf = _dict(_dict(_dict(nodes.get(node_name)).get("vrfs")).get(str(name)))
            transit = _dict(node_vrf.get("evpn")).get("transit_vni")
            if transit:
                evpn_transit = transit
                break
        object_refs = [f"vrf:{name}"] + [f"node:{node}" for node in sorted(member_nodes)]
        vrfs.append(
            {
                "name": str(name),
                "id": vrf.get("id") if isinstance(vrf.get("id"), int) else None,
                "rd": str(vrf.get("rd")) if vrf.get("rd") else None,
                "importTargets": [str(rt) for rt in _list(vrf.get("import"))],
                "exportTargets": [str(rt) for rt in _list(vrf.get("export"))],
                "evpnTransitVni": evpn_transit,
                "nodeIds": sorted(member_nodes),
                "vlans": vrf_vlans,
                "colorKey": _color_key("vrf", str(name), vrf.get("id")),
                "objectRefs": object_refs,
            }
        )

    # ── VXLAN VTEPs + tunnel mesh ────────────────────────────────────────────
    vteps: list[dict[str, Any]] = []
    for node_name, raw_node in nodes.items():
        node_vxlan = _dict(_dict(raw_node).get("vxlan"))
        vtep = node_vxlan.get("vtep")
        if not vtep:
            continue
        vteps.append(
            {
                "node": str(node_name),
                "address": str(vtep),
                "interface": str(node_vxlan.get("vtep_interface") or "lo"),
                "vlans": [str(v) for v in _list(node_vxlan.get("vlans"))],
            }
        )
    # VTEPs sharing at least one VXLAN VLAN form a (rendered) tunnel.
    tunnels: list[dict[str, Any]] = []
    for i in range(len(vteps)):
        for j in range(i + 1, len(vteps)):
            shared = sorted(set(vteps[i]["vlans"]) & set(vteps[j]["vlans"]))
            if shared:
                tunnels.append(
                    {
                        "source": vteps[i]["node"],
                        "target": vteps[j]["node"],
                        "vlans": shared,
                        "colorKey": "vxlan:tunnel",
                    }
                )

    evpn_summary = {
        "enabled": bool(top_evpn),
        "sessions": [str(s) for s in _list(top_evpn.get("session"))],
        "transport": str(top_vxlan.get("flooding")) if top_vxlan.get("flooding") else None,
        "vlans": [str(v) for v in _list(top_evpn.get("vlans"))],
        "vrfs": [str(v) for v in _list(top_evpn.get("vrfs"))],
    }

    return {
        "available": bool(top_vlans or top_vrfs or top_vxlan or top_evpn),
        "vlans": vlans,
        "vrfs": vrfs,
        "vteps": vteps,
        "tunnels": tunnels,
        "evpn": evpn_summary,
    }
