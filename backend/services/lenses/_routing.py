"""Build the ControlPlaneLens (BGP/OSPF/IS-IS/BFD/EVPN adjacencies) and the
per-node service summary, from the addressing pass's segment/edge metadata."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from services.lenses._helpers import FAMILIES, SERVICE_MODULES, as_dict, as_list, stable_id, yaml_fragment


def _interface_name(node: dict[str, Any], neighbor: dict[str, Any]) -> str | None:
    source = as_dict(neighbor.get("_source_intf"))
    if source.get("ifname"):
        return str(source["ifname"])
    ifindex = neighbor.get("ifindex")
    if ifindex is not None:
        interface = next(
            (item for item in as_list(node.get("interfaces")) if as_dict(item).get("ifindex") == ifindex),
            None,
        )
        if as_dict(interface).get("ifname"):
            return str(as_dict(interface)["ifname"])
    if source:
        return str(source.get("ifname") or "loopback")
    return None


def _address_for_family(interface: dict[str, Any], families: list[str]) -> str | None:
    for family in families:
        value = interface.get(family)
        if isinstance(value, str):
            return value
    return None


def _find_reciprocal(nodes: dict[str, Any], source: str, target: str, protocol: str = "bgp") -> dict[str, Any]:
    target_node = as_dict(nodes.get(target))
    neighbors = as_list(as_dict(target_node.get(protocol)).get("neighbors"))
    return next((as_dict(item) for item in neighbors if as_dict(item).get("name") == source), {})


def build_routing(
    transformed: dict[str, Any], addressing_meta: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    nodes = as_dict(transformed.get("nodes"))
    segments = addressing_meta["segments"]
    pair_edge_ids: dict[frozenset[str], list[str]] = addressing_meta["pairEdgeIds"]
    adjacencies: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    node_rows: list[dict[str, Any]] = []
    services: list[dict[str, Any]] = []

    active_ospf_areas: dict[str, set[str]] = defaultdict(set)
    for node_name, raw_node in nodes.items():
        node = as_dict(raw_node)
        for raw_interface in as_list(node.get("interfaces")):
            interface = as_dict(raw_interface)
            if "ospf" not in interface or interface.get("ospf") is False:
                continue
            ospf = as_dict(interface.get("ospf"))
            if not ospf.get("passive", False):
                area = ospf.get("area") or as_dict(node.get("ospf")).get("area") or "0.0.0.0"
                active_ospf_areas[str(node_name)].add(str(area))

    for node_name, raw_node in nodes.items():
        node = as_dict(raw_node)
        bgp = as_dict(node.get("bgp"))
        ospf = as_dict(node.get("ospf"))
        isis = as_dict(node.get("isis"))
        modules = {str(module) for module in as_list(node.get("module"))}
        node_services = sorted(modules & SERVICE_MODULES)
        node_rows.append(
            {
                "node": str(node_name),
                "bgpAs": str(bgp.get("as")) if bgp.get("as") is not None else None,
                "routeReflector": bool(bgp.get("rr")),
                "ospfAreas": sorted(active_ospf_areas.get(str(node_name), set())),
                "ospfAbr": len(active_ospf_areas.get(str(node_name), set())) > 1,
                "isisArea": str(isis.get("area")) if isis.get("area") is not None else None,
                "isisLevel": str(isis.get("type")) if isis.get("type") is not None else None,
                "services": node_services,
            }
        )
        if bgp.get("rr"):
            markers.append(
                {
                    "id": f"marker:bgp:rr:{node_name}",
                    "protocol": "bgp",
                    "kind": "route-reflector",
                    "node": str(node_name),
                    "label": "RR",
                    "objectRefs": [f"node:{node_name}"],
                }
            )
        if len(active_ospf_areas.get(str(node_name), set())) > 1:
            markers.append(
                {
                    "id": f"marker:ospf:abr:{node_name}",
                    "protocol": "ospf",
                    "kind": "abr",
                    "node": str(node_name),
                    "label": "ABR",
                    "objectRefs": [f"node:{node_name}"],
                }
            )
        services.append(
            {
                "node": str(node_name),
                "services": node_services,
                "vrfs": sorted(str(name) for name in as_dict(node.get("vrfs"))),
                "vlans": sorted(str(name) for name in as_dict(node.get("vlans"))),
            }
        )

    # BGP and EVPN logical sessions come directly from Netlab's resolved
    # neighbor list. Reciprocal records are canonicalized into one adjacency.
    seen_bgp: set[tuple[Any, ...]] = set()
    for source, raw_node in sorted(nodes.items()):
        node = as_dict(raw_node)
        bgp = as_dict(node.get("bgp"))
        for raw_neighbor in as_list(bgp.get("neighbors")):
            neighbor = as_dict(raw_neighbor)
            target = str(neighbor.get("name") or "")
            if not target or target not in nodes:
                continue
            session_type = str(neighbor.get("type") or "bgp")
            vrf = str(neighbor.get("vrf") or "default")
            families = sorted(str(name) for name, enabled in as_dict(neighbor.get("activate")).items() if enabled)
            if not families:
                families = [family for family in FAMILIES if neighbor.get(family)]
            key = (tuple(sorted((str(source), target))), session_type, vrf, tuple(families))
            if key in seen_bgp:
                continue
            seen_bgp.add(key)
            reciprocal = _find_reciprocal(nodes, str(source), target)
            target_node = as_dict(nodes.get(target))
            source_interface = _interface_name(node, neighbor)
            target_interface = _interface_name(target_node, reciprocal)
            source_view = as_dict(neighbor.get("_source_intf"))
            source_address = _address_for_family(source_view, families)
            target_address = next((str(neighbor.get(family)) for family in families if neighbor.get(family)), None)
            source_as = str(bgp.get("local_as") or bgp.get("as")) if bgp.get("as") is not None else None
            target_as = str(neighbor.get("as")) if neighbor.get("as") is not None else None
            rr_nodes = []
            if bgp.get("rr") or neighbor.get("rr"):
                rr_nodes.append(str(source))
            if as_dict(target_node.get("bgp")).get("rr") or reciprocal.get("rr"):
                rr_nodes.append(target)
            edge_ids = pair_edge_ids.get(frozenset((str(source), target)), [])
            adj_id = stable_id("bgp", vrf, *sorted((str(source), target)), session_type, ",".join(families))
            explanation = [
                (
                    "Netlab derived an eBGP session from different effective autonomous systems on a shared link."
                    if "ebgp" in session_type
                    else "Netlab derived an iBGP session between nodes in the same effective autonomous system."
                )
            ]
            if rr_nodes:
                explanation.append(f"Route-reflector behavior is active on {', '.join(sorted(set(rr_nodes)))}.")
            settings = {
                "source": {"bgp": {key: bgp.get(key) for key in ("as", "local_as", "rr", "router_id") if key in bgp}},
                "neighbor": {key: value for key, value in neighbor.items() if not str(key).startswith("_")},
            }
            adjacency = {
                "id": adj_id,
                "protocol": "bgp",
                "nodeIds": sorted((str(source), target)),
                "source": str(source),
                "target": target,
                "physicalEdgeIds": edge_ids,
                "sessionType": session_type,
                "addressFamilies": families,
                "sourceAs": source_as,
                "targetAs": target_as,
                "sourceInterface": source_interface,
                "targetInterface": target_interface,
                "sourceAddress": source_address,
                "targetAddress": target_address,
                "status": "configured",
                "routeReflectorNodes": sorted(set(rr_nodes)),
                "colorKey": f"as:{source_as or 'unknown'}",
                "explanation": explanation,
                "settings": settings,
                "yamlPaths": [f"nodes.{source}.bgp", f"nodes.{target}.bgp"],
                "resolvedYaml": yaml_fragment(settings),
            }
            adjacencies.append(adjacency)
            if neighbor.get("evpn") is not None:
                evpn_settings = {
                    "transport": as_dict(node.get("evpn")).get("transport"),
                    "session": as_dict(node.get("evpn")).get("session"),
                    "neighbor": {"evpn": neighbor.get("evpn"), "activate": neighbor.get("activate")},
                }
                adjacencies.append(
                    {
                        **adjacency,
                        "id": stable_id("evpn", adj_id),
                        "protocol": "evpn",
                        "sessionType": f"{session_type}-evpn",
                        "colorKey": f"evpn:{evpn_settings.get('transport') or 'overlay'}",
                        "explanation": [
                            "Netlab activated EVPN on this resolved BGP control-plane session.",
                            f"Overlay transport is {evpn_settings.get('transport') or 'device/default dependent'}.",
                        ],
                        "settings": evpn_settings,
                        "yamlPaths": [f"nodes.{source}.evpn", f"nodes.{source}.bgp.neighbors"],
                        "resolvedYaml": yaml_fragment(evpn_settings),
                    }
                )

    # Physical protocol segments are represented as hyperedges: a multi-access
    # LAN remains one object with several spokes, never a misleading full mesh.
    for segment in segments:
        endpoint_data: list[tuple[str, dict[str, Any]]] = []
        for endpoint in segment["endpoints"]:
            node_name = endpoint["node"]
            node = as_dict(nodes.get(node_name))
            interface = next(
                (
                    as_dict(item)
                    for item in as_list(node.get("interfaces"))
                    if str(as_dict(item).get("ifname") or "") == endpoint["interface"]
                ),
                {},
            )
            endpoint_data.append((node_name, interface))

        active_ospf = []
        for node_name, interface in endpoint_data:
            if "ospf" not in interface or interface.get("ospf") is False:
                continue
            ospf = as_dict(interface.get("ospf"))
            area = str(ospf.get("area") or as_dict(as_dict(nodes.get(node_name)).get("ospf")).get("area") or "0.0.0.0")
            if ospf.get("passive", False):
                markers.append(
                    {
                        "id": stable_id("marker", "ospf-passive", segment["id"], node_name),
                        "protocol": "ospf",
                        "kind": "passive-interface",
                        "node": node_name,
                        "interface": interface.get("ifname"),
                        "label": "passive",
                        "objectRefs": [segment["id"], f"node:{node_name}"],
                    }
                )
            else:
                active_ospf.append((node_name, interface, area))
        if len(active_ospf) >= 2:
            areas = sorted({area for _node, _interface_data, area in active_ospf})
            adj_id = stable_id("ospf", segment["id"], ",".join(areas))
            settings = {
                node_name: {"interface": interface.get("ifname"), "ospf": interface.get("ospf")}
                for node_name, interface, _area in active_ospf
            }
            adjacencies.append(
                {
                    "id": adj_id,
                    "protocol": "ospf",
                    "nodeIds": [node_name for node_name, _interface_data, _area in active_ospf],
                    "source": active_ospf[0][0],
                    "target": active_ospf[1][0],
                    "physicalEdgeIds": segment["physicalEdgeIds"],
                    "segmentId": segment["id"],
                    "sessionType": "area-segment",
                    "addressFamilies": sorted(segment["prefixes"]),
                    "sourceInterface": active_ospf[0][1].get("ifname"),
                    "targetInterface": active_ospf[1][1].get("ifname"),
                    "area": areas[0] if len(areas) == 1 else ", ".join(areas),
                    "status": "configured",
                    "colorKey": f"ospf-area:{areas[0] if areas else 'unknown'}",
                    "explanation": ["Netlab enabled OSPF on the active interfaces attached to this segment."],
                    "settings": settings,
                    "yamlPaths": segment["yamlPaths"],
                    "resolvedYaml": yaml_fragment(settings),
                }
            )
            if len(areas) > 1:
                warnings.append(
                    {
                        "id": stable_id("warning", "ospf-area-mismatch", segment["id"]),
                        "severity": "warning",
                        "kind": "ospf-area-mismatch",
                        "message": f"OSPF interfaces on one segment use different areas: {', '.join(areas)}",
                        "objectRefs": [adj_id, segment["id"]],
                    }
                )

        active_isis = []
        for node_name, interface in endpoint_data:
            if "isis" not in interface or interface.get("isis") is False:
                continue
            isis = as_dict(interface.get("isis"))
            if isis.get("passive", False):
                markers.append(
                    {
                        "id": stable_id("marker", "isis-passive", segment["id"], node_name),
                        "protocol": "isis",
                        "kind": "passive-interface",
                        "node": node_name,
                        "interface": interface.get("ifname"),
                        "label": "passive",
                        "objectRefs": [segment["id"], f"node:{node_name}"],
                    }
                )
            else:
                active_isis.append((node_name, interface, as_dict(as_dict(nodes.get(node_name)).get("isis"))))
        if len(active_isis) >= 2:
            node_levels = [str(isis.get("type") or "level-1-2") for _node, _interface_data, isis in active_isis]
            supports_l1 = all(level in {"level-1", "level-1-2"} for level in node_levels)
            supports_l2 = all(level in {"level-2", "level-1-2"} for level in node_levels)
            if supports_l1 and supports_l2:
                level = "level-1-2"
            elif supports_l1:
                level = "level-1"
            elif supports_l2:
                level = "level-2"
            else:
                level = "incompatible"
            areas = sorted({str(isis.get("area") or "49.0001") for _node, _interface_data, isis in active_isis})
            adj_id = stable_id("isis", segment["id"], level, ",".join(areas))
            settings = {
                node_name: {"isis": isis, "interface": interface.get("isis")}
                for node_name, interface, isis in active_isis
            }
            adjacencies.append(
                {
                    "id": adj_id,
                    "protocol": "isis",
                    "nodeIds": [node_name for node_name, _interface_data, _isis in active_isis],
                    "source": active_isis[0][0],
                    "target": active_isis[1][0],
                    "physicalEdgeIds": segment["physicalEdgeIds"],
                    "segmentId": segment["id"],
                    "sessionType": "level-segment",
                    "addressFamilies": sorted(segment["prefixes"]),
                    "sourceInterface": active_isis[0][1].get("ifname"),
                    "targetInterface": active_isis[1][1].get("ifname"),
                    "area": ", ".join(areas),
                    "level": level,
                    "status": "configured",
                    "colorKey": f"isis:{level}",
                    "explanation": [f"The effective IS-IS relationship on this segment is {level}."],
                    "settings": settings,
                    "yamlPaths": segment["yamlPaths"],
                    "resolvedYaml": yaml_fragment(settings),
                }
            )

        bfd_endpoints = [(node_name, interface) for node_name, interface in endpoint_data if "bfd" in interface]
        if len(bfd_endpoints) >= 2:
            settings = {
                node_name: {"interface": interface.get("ifname"), "bfd": interface.get("bfd")}
                for node_name, interface in bfd_endpoints
            }
            adjacencies.append(
                {
                    "id": stable_id("bfd", segment["id"]),
                    "protocol": "bfd",
                    "nodeIds": [node_name for node_name, _interface_data in bfd_endpoints],
                    "source": bfd_endpoints[0][0],
                    "target": bfd_endpoints[1][0],
                    "physicalEdgeIds": segment["physicalEdgeIds"],
                    "segmentId": segment["id"],
                    "sessionType": "configured",
                    "addressFamilies": sorted(segment["prefixes"]),
                    "sourceInterface": bfd_endpoints[0][1].get("ifname"),
                    "targetInterface": bfd_endpoints[1][1].get("ifname"),
                    "status": "unknown",
                    "colorKey": "bfd:unknown",
                    "explanation": [
                        "BFD is configured on both segment endpoints.",
                        "Operational health is unknown because no device-specific BFD telemetry is available.",
                    ],
                    "settings": settings,
                    "yamlPaths": segment["yamlPaths"],
                    "resolvedYaml": yaml_fragment(settings),
                }
            )

    available = [
        protocol
        for protocol in ("bgp", "ospf", "isis", "bfd", "evpn")
        if any(item["protocol"] == protocol for item in adjacencies)
        or any(item["protocol"] == protocol for item in markers)
    ]
    return (
        {
            "nodes": node_rows,
            "adjacencies": adjacencies,
            "markers": markers,
            "warnings": warnings,
            "availableLayers": available,
        },
        services,
    )
