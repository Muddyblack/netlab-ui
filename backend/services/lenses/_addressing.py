"""Build the AddressingLens (segments, pools, loopbacks, assignments)."""

from __future__ import annotations

import json
from collections import defaultdict
from itertools import combinations
from typing import Any

from services.lenses._helpers import (
    FAMILIES,
    IP_NETWORK,
    as_dict,
    as_interface,
    as_list,
    as_network,
    edge_ids,
    source_has_manual_address,
    source_link,
    stable_id,
)


def _pool_networks(transformed: dict[str, Any]) -> list[dict[str, Any]]:
    pools: list[dict[str, Any]] = []
    for name, raw_pool in as_dict(transformed.get("addressing")).items():
        pool = as_dict(raw_pool)
        for family in FAMILIES:
            network = as_network(pool.get(family))
            if network is None:
                continue
            allocation_prefix = pool.get("prefix6" if family == "ipv6" else "prefix")
            if not isinstance(allocation_prefix, int):
                allocation_prefix = None
            pools.append(
                {
                    "id": f"pool:{family}:{name}",
                    "name": str(name),
                    "family": family,
                    "network": network,
                    "allocationPrefix": allocation_prefix,
                }
            )
    return pools


def _find_pool(
    pools: list[dict[str, Any]],
    family: str,
    network: IP_NETWORK | None,
    preferred: str | None = None,
) -> dict[str, Any] | None:
    candidates = [
        pool
        for pool in pools
        if pool["family"] == family and network is not None and network.subnet_of(pool["network"])
    ]
    if preferred:
        exact = next((pool for pool in candidates if pool["name"] == preferred), None)
        if exact:
            return exact
    # Prefer the most specific containing pool; loopback/router-id pools often
    # share a parent prefix and should not steal ordinary link allocations.
    return max(candidates, key=lambda pool: pool["network"].prefixlen, default=None)


def _assignment(
    *,
    family: str,
    value: str,
    node: str,
    interface_name: str,
    kind: str,
    pool: str | None,
    segment_id: str | None,
    origin: str,
) -> dict[str, Any] | None:
    parsed = as_interface(value)
    if parsed is None:
        return None
    assignment_id = f"address:{family}:{node}:{interface_name}:{parsed.ip.compressed}"
    refs = [assignment_id, f"node:{node}"]
    if segment_id:
        refs.append(segment_id)
    return {
        "id": assignment_id,
        "family": family,
        "address": str(parsed),
        "node": node,
        "interface": interface_name,
        "kind": kind,
        "pool": pool,
        "segmentId": segment_id,
        "origin": origin,
        "objectRefs": refs,
    }


def build_addressing(
    transformed: dict[str, Any], source: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    pools = _pool_networks(transformed)
    segments: list[dict[str, Any]] = []
    assignments: list[dict[str, Any]] = []
    loopbacks: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    segment_networks: list[tuple[str, str, IP_NETWORK, str | None, str | None]] = []
    pair_edge_ids: dict[frozenset[str], list[str]] = defaultdict(list)

    for fallback_index, raw_link in enumerate(as_list(transformed.get("links")), start=1):
        link = as_dict(raw_link)
        endpoints = [as_dict(endpoint) for endpoint in as_list(link.get("interfaces")) if as_dict(endpoint).get("node")]
        if not endpoints:
            continue
        link_index = int(link.get("linkindex") or fallback_index)
        endpoint_key = ",".join(
            sorted(f"{endpoint.get('node')}@{endpoint.get('ifname', '')}" for endpoint in endpoints)
        )
        prefixes = {
            family: str(value)
            for family, value in as_dict(link.get("prefix")).items()
            if family in FAMILIES and as_network(value) is not None
        }
        vrf = str(link.get("vrf")) if link.get("vrf") is not None else None
        vlan = str(link.get("vlan_name") or link.get("vlan")) if link.get("vlan_name") or link.get("vlan") else None
        segment_id = stable_id("segment", endpoint_key, vrf, vlan, json.dumps(prefixes, sort_keys=True))
        preferred_pool = str(link.get("pool") or link.get("type") or "") or None
        pool_names: dict[str, str] = {}
        for family, prefix in prefixes.items():
            net = as_network(prefix)
            matched = _find_pool(pools, family, net, preferred_pool)
            if matched:
                pool_names[family] = matched["name"]
            if net:
                segment_networks.append((segment_id, family, net, vrf, vlan))

        src_link = source_link(link, source)
        origin = "manual" if source_has_manual_address(src_link) else "automatic"
        if any(
            value in {True, "unnumbered"}
            for endpoint in endpoints
            for value in (endpoint.get("ipv4"), endpoint.get("ipv6"))
        ):
            origin = "unnumbered"
        segment_edge_ids = edge_ids(link_index, endpoints)
        endpoint_rows: list[dict[str, Any]] = []
        for endpoint in endpoints:
            node = str(endpoint.get("node"))
            ifname = str(endpoint.get("ifname") or "")
            endpoint_refs = [segment_id, f"node:{node}"]
            row = {
                "node": node,
                "interface": ifname,
                "ipv4": endpoint.get("ipv4") if isinstance(endpoint.get("ipv4"), str) else None,
                "ipv6": endpoint.get("ipv6") if isinstance(endpoint.get("ipv6"), str) else None,
                "objectRefs": endpoint_refs,
            }
            endpoint_rows.append(row)
            for family in FAMILIES:
                value = endpoint.get(family)
                if not isinstance(value, str):
                    continue
                assignment = _assignment(
                    family=family,
                    value=value,
                    node=node,
                    interface_name=ifname,
                    kind="interface",
                    pool=pool_names.get(family),
                    segment_id=segment_id,
                    origin=origin,
                )
                if assignment:
                    assignments.append(assignment)

        yaml_paths = [str(link.get("_linkname"))] if link.get("_linkname") else []
        segments.append(
            {
                "id": segment_id,
                "nodeIds": [str(endpoint.get("node")) for endpoint in endpoints],
                "physicalEdgeIds": segment_edge_ids,
                "endpoints": endpoint_rows,
                "prefixes": prefixes,
                "pools": pool_names,
                "assignmentOrigin": origin,
                "vrf": vrf,
                "vlan": vlan,
                "role": str(link.get("role")) if link.get("role") is not None else None,
                "colorKey": next(iter(pool_names.values()), next(iter(prefixes.values()), segment_id)),
                "yamlPaths": yaml_paths,
                "warnings": [],
            }
        )
        for left, right in combinations({str(endpoint.get("node")) for endpoint in endpoints}, 2):
            pair_edge_ids[frozenset((left, right))].extend(segment_edge_ids)

    for node_name, raw_node in as_dict(transformed.get("nodes")).items():
        node = as_dict(raw_node)
        loopback = as_dict(node.get("loopback"))
        if loopback:
            pools_by_family: dict[str, str] = {}
            for family in FAMILIES:
                value = loopback.get(family)
                parsed = as_interface(value)
                if parsed is None:
                    continue
                matched = _find_pool(pools, family, parsed.network, "loopback")
                if matched:
                    pools_by_family[family] = matched["name"]
                assignment = _assignment(
                    family=family,
                    value=str(value),
                    node=str(node_name),
                    interface_name=str(loopback.get("ifname") or "loopback"),
                    kind="loopback",
                    pool=matched["name"] if matched else None,
                    segment_id=None,
                    origin="automatic",
                )
                if assignment:
                    assignments.append(assignment)
            if any(isinstance(loopback.get(family), str) for family in FAMILIES):
                loopbacks.append(
                    {
                        "id": f"loopback:{node_name}",
                        "node": str(node_name),
                        "interface": str(loopback.get("ifname") or "loopback"),
                        "ipv4": loopback.get("ipv4") if isinstance(loopback.get("ipv4"), str) else None,
                        "ipv6": loopback.get("ipv6") if isinstance(loopback.get("ipv6"), str) else None,
                        "pools": pools_by_family,
                    }
                )

        mgmt = as_dict(node.get("mgmt"))
        for family in FAMILIES:
            value = mgmt.get(family)
            if not isinstance(value, str):
                continue
            parsed = as_interface(value if "/" in value else f"{value}/{'32' if family == 'ipv4' else '128'}")
            matched = _find_pool(pools, family, parsed.network if parsed else None, "mgmt")
            assignment = _assignment(
                family=family,
                value=value if "/" in value else f"{value}/{'32' if family == 'ipv4' else '128'}",
                node=str(node_name),
                interface_name=str(mgmt.get("ifname") or "mgmt"),
                kind="management",
                pool=matched["name"] if matched else None,
                segment_id=None,
                origin="automatic",
            )
            if assignment:
                assignments.append(assignment)

    # Duplicate host addresses. Netlab can intentionally share gateway/anycast
    # addresses; classify same-VLAN segment duplicates as informational.
    by_ip: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in assignments:
        parsed = as_interface(item["address"])
        if parsed:
            by_ip[(item["family"], parsed.ip.compressed)].append(item)
    duplicate_count = 0
    for (family, address), matches in by_ip.items():
        nodes = {item["node"] for item in matches}
        if len(matches) < 2 or len(nodes) < 2:
            continue
        duplicate_count += 1
        refs = [item["id"] for item in matches]
        warning = {
            "id": stable_id("warning", "duplicate", family, address),
            "severity": "error",
            "kind": "duplicate-address",
            "message": f"{address} is assigned to {', '.join(sorted(nodes))}",
            "objectRefs": refs,
        }
        warnings.append(warning)

    for left, right in combinations(segment_networks, 2):
        left_id, family, left_net, left_vrf, left_vlan = left
        right_id, right_family, right_net, right_vrf, right_vlan = right
        if family != right_family or left_id == right_id or left_vrf != right_vrf:
            continue
        if left_vlan and left_vlan == right_vlan and left_net == right_net:
            continue
        if left_net.overlaps(right_net):
            warnings.append(
                {
                    "id": stable_id("warning", "overlap", left_id, right_id, family),
                    "severity": "error",
                    "kind": "overlapping-prefix",
                    "message": f"{left_net} overlaps {right_net}",
                    "objectRefs": [left_id, right_id],
                }
            )

    pool_rows: list[dict[str, Any]] = []
    for pool in pools:
        network = pool["network"]
        family = pool["family"]
        allocated = {
            net
            for _segment_id, net_family, net, _vrf, _vlan in segment_networks
            if net_family == family and net.subnet_of(network)
        }
        allocation_prefix = pool["allocationPrefix"]
        subnet_capacity = (
            2 ** (allocation_prefix - network.prefixlen)
            if allocation_prefix is not None and allocation_prefix >= network.prefixlen
            else 1
        )
        used_subnets = len(allocated)
        free_subnets = max(0, subnet_capacity - used_subnets)
        assigned = sum(1 for item in assignments if item.get("pool") == pool["name"] and item["family"] == family)
        address_capacity = network.num_addresses
        if family == "ipv4" and network.prefixlen < 31:
            address_capacity = max(0, address_capacity - 2)
        exhausted = free_subnets == 0 and used_subnets > 0
        row = {
            "id": pool["id"],
            "name": pool["name"],
            "family": family,
            "network": str(network),
            "allocationPrefix": allocation_prefix,
            "usedSubnets": str(used_subnets),
            "freeSubnets": str(free_subnets),
            "subnetCapacity": str(subnet_capacity),
            "assignedAddresses": str(assigned),
            "addressCapacity": str(address_capacity),
            "utilization": round((used_subnets / subnet_capacity * 100) if subnet_capacity else 100.0, 2),
            "exhausted": exhausted,
        }
        pool_rows.append(row)
        if exhausted:
            warnings.append(
                {
                    "id": stable_id("warning", "exhausted", pool["id"]),
                    "severity": "warning",
                    "kind": "exhausted-pool",
                    "message": f"Address pool {pool['name']} ({family}) has no free allocation prefixes",
                    "objectRefs": [pool["id"]],
                }
            )

    warnings_by_ref: dict[str, list[str]] = defaultdict(list)
    for warning in warnings:
        for ref in warning["objectRefs"]:
            warnings_by_ref[ref].append(warning["id"])
    for segment in segments:
        segment["warnings"] = warnings_by_ref.get(segment["id"], [])

    families = [family for family in FAMILIES if any(item["family"] == family for item in assignments)]
    return (
        {
            "families": families,
            "segments": segments,
            "loopbacks": loopbacks,
            "assignments": assignments,
            "pools": pool_rows,
            "warnings": warnings,
            "duplicateCount": duplicate_count,
            "manualAssignmentCount": sum(1 for item in assignments if item["origin"] == "manual"),
        },
        {"pairEdgeIds": pair_edge_ids, "segments": segments},
    )
