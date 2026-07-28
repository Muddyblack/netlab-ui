"""Shared primitives for the Lens analyzer (addressing + routing).

Netlab has already resolved address pools, inherited module values and
protocol sessions in the transformed topology; these helpers normalize
those results for visualization instead of reimplementing Netlab's
derivation rules.
"""

from __future__ import annotations

import hashlib
import ipaddress
from typing import Any

from ruamel.yaml import YAML

FAMILIES = ("ipv4", "ipv6")
SERVICE_MODULES = {"dhcp", "evpn", "gateway", "mpls", "srv6", "vlan", "vrf", "vxlan"}
IP_NETWORK = ipaddress.IPv4Network | ipaddress.IPv6Network


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


def edge_ids(link_index: int, endpoints: list[dict[str, Any]]) -> list[str]:
    # e<N> mirrors the current clab projection where possible. Endpoint
    # selectors in the response remain authoritative when provider projections
    # insert bridge nodes or otherwise change physical edge ids.
    if len(endpoints) == 2:
        return [f"e{max(0, link_index - 1)}"]
    return []


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
