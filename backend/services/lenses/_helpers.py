"""Shared primitives for the Lens analyzer (addressing + routing).

Netlab has already resolved address pools, inherited module values and
protocol sessions in the transformed topology; these helpers normalize
those results for visualization instead of reimplementing Netlab's
derivation rules.
"""

from __future__ import annotations

import hashlib
import ipaddress
import re
from typing import Any

from ruamel.yaml import YAML

from services.model.edge_ids import EdgeIdCounter, edge_id

FAMILIES = ("ipv4", "ipv6")
SERVICE_MODULES = {"dhcp", "evpn", "gateway", "mpls", "srv6", "vlan", "vrf", "vxlan"}
IP_NETWORK = ipaddress.IPv4Network | ipaddress.IPv6Network


def natural_key(value: str) -> tuple[tuple[int, Any], ...]:
    """Sort key that compares embedded numbers numerically: ``r2`` before ``r10``.

    Plain string sorting interleaves them — ``r1, r10, r11, …, r15, r2, r3`` —
    which is what the node pickers were showing. netlab labs name nodes with
    numeric suffixes almost universally, so lexicographic order is close to
    always wrong for a list a human reads.

    Use this for lists that are *displayed*. Do not use it for sorts that feed an
    identity (``stable_id`` inputs) or a lookup set: changing their order changes
    the ids downstream for no visible benefit.
    """
    return tuple((1, int(part)) if part.isdigit() else (0, part) for part in re.split(r"(\d+)", value) if part != "")


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_network(value: Any) -> ipaddress.IPv4Network | ipaddress.IPv6Network | None:
    if not isinstance(value, str) or not value or value.lower() in {"true", "false", "unnumbered"}:
        return None
    try:
        return ipaddress.ip_network(value, strict=False)
    except ValueError:
        return None


def as_interface(value: Any) -> ipaddress.IPv4Interface | ipaddress.IPv6Interface | None:
    if not isinstance(value, str) or not value or value.lower() in {"true", "false", "unnumbered"}:
        return None
    try:
        return ipaddress.ip_interface(value)
    except ValueError:
        return None


def stable_id(kind: str, *parts: Any) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return f"{kind}:{hashlib.sha1(raw.encode()).hexdigest()[:16]}"


def edge_ids(endpoints: list[dict[str, Any]], seen: EdgeIdCounter) -> list[str]:
    """Canvas edge ids for a transformed link, so overlays can bind to it.

    Shares :func:`services.model.edge_ids.edge_id` with the canvas projections
    rather than reconstructing the scheme, which is what previously made the
    binding fragile. Pass one ``seen`` dict across a whole link list so parallel
    links are numbered the same way the projection numbers them.

    Only point-to-point links map onto a single canvas edge; a multi-access link
    is drawn through the provider's bridge node, so the endpoint selectors in
    the response stay authoritative there. The id is still consumed for those,
    to keep the parallel-link numbering in step with the canvas projection,
    which also derives an edge from the first two endpoints of every link.
    """
    if len(endpoints) < 2:
        return []
    ids = [
        edge_id(
            str(endpoints[0].get("node") or ""),
            str(endpoints[1].get("node") or ""),
            seen,
        )
    ]
    return ids if len(endpoints) == 2 else []


def edge_ids_by_linkindex(transformed: dict[str, Any]) -> dict[int, list[str]]:
    """Map netlab's ``linkindex`` to canvas edge ids for a transformed topology.

    For callers that walk per-*adjacency* rather than per-link (the path
    explorer visits each link once from each end), where threading the shared
    occurrence counter would double-count. Building the map from the link list
    keeps the parallel-link numbering identical to every other caller's.
    """
    seen: EdgeIdCounter = {}
    by_index: dict[int, list[str]] = {}
    for raw_link in as_list(transformed.get("links")):
        link = as_dict(raw_link)
        endpoints = [as_dict(endpoint) for endpoint in as_list(link.get("interfaces")) if as_dict(endpoint).get("node")]
        ids = edge_ids(endpoints, seen)
        index = link.get("linkindex")
        if isinstance(index, int):
            by_index[index] = ids
    return by_index


def source_link(link: dict[str, Any], source: dict[str, Any] | None) -> dict[str, Any]:
    links = as_list(as_dict(source).get("links"))
    name = str(link.get("_linkname") or "")
    if name.startswith("links[") and name.endswith("]"):
        try:
            index = int(name[6:-1]) - 1
            return as_dict(links[index]) if 0 <= index < len(links) else {}
        except (ValueError, IndexError):
            return {}
    return {}


def source_has_manual_address(source_link_: dict[str, Any]) -> bool:
    if any(key in source_link_ for key in ("prefix", "ipv4", "ipv6")):
        return True
    return any(
        isinstance(endpoint, dict) and any(key in endpoint for key in ("ipv4", "ipv6"))
        for endpoint in as_list(source_link_.get("interfaces"))
    )


def yaml_fragment(value: dict[str, Any]) -> str:
    from io import StringIO

    stream = StringIO()
    yaml = YAML()
    yaml.default_flow_style = False
    yaml.dump(value, stream)
    return stream.getvalue()
