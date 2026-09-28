"""Search a lab's *transformed* topology: which node has 10.1.0.5, what sits in
10.1.0.0/24, who runs AS 65001 or carries VLAN 10, which nodes use OSPF.

The facts come from ``netlab create``'s output, so they include everything
netlab derived (pool addresses, inherited modules, VLAN ids), not only what
the YAML spells out. Each hit names the nodes the canvas should spotlight.

Query forms:

* an address (``10.1.0.5``) — interfaces holding it, or whose subnet has it
* a prefix (``10.1.0.0/24``) — every address inside it
* ``as 65001`` / ``as65001`` — BGP AS
* a bare number — AS, VLAN id or node id
* ``kind:text`` with kind in node, device, role, module, group, vlan, vrf,
  as, ip — restrict to one kind
* anything else — a substring of a node, device, role, module, group, VLAN or
  VRF name
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from typing import Any

from ._helpers import as_dict, as_list, natural_key

KINDS = ("node", "device", "role", "module", "group", "vlan", "vrf", "as", "ip")
MAX_RESULTS = 60


@dataclass
class Fact:
    kind: str
    title: str
    detail: str
    nodes: list[str]
    text: str  # what text queries match against (lower-case)
    number: int | None = None
    address: ipaddress.IPv4Interface | ipaddress.IPv6Interface | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def _interface(value: Any) -> ipaddress.IPv4Interface | ipaddress.IPv6Interface | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return ipaddress.ip_interface(value)
    except ValueError:
        return None


def _address_facts(name: str, node: dict[str, Any]) -> list[Fact]:
    facts: list[Fact] = []
    mgmt = as_dict(node.get("mgmt"))
    for family in ("ipv4", "ipv6"):
        if address := _interface(mgmt.get(family)):
            facts.append(
                Fact(
                    "ip",
                    str(address.ip),
                    f"{name} · management ({mgmt.get('ifname') or 'mgmt'})",
                    [name],
                    str(address.ip),
                    address=address,
                )
            )
    for iface in [as_dict(node.get("loopback")), *[as_dict(i) for i in as_list(node.get("interfaces"))]]:
        ifname = str(iface.get("ifname") or "")
        neighbors = sorted(
            {str(as_dict(n).get("node")) for n in as_list(iface.get("neighbors")) if as_dict(n).get("node")}
        )
        for family in ("ipv4", "ipv6"):
            address = _interface(iface.get(family))
            if not address:
                continue
            towards = f" → {', '.join(neighbors)}" if neighbors else ""
            label = "loopback" if iface.get("type") == "loopback" else ifname
            facts.append(
                Fact(
                    "ip", str(address), f"{name} · {label}{towards}", [name, *neighbors], str(address), address=address
                )
            )
    return facts


def _node_facts(name: str, node: dict[str, Any]) -> list[Fact]:
    facts = [
        Fact(
            "node",
            name,
            f"{node.get('device') or ''} node #{node.get('id', '?')}".strip(),
            [name],
            name.lower(),
            number=node.get("id") if isinstance(node.get("id"), int) else None,
        )
    ]
    if node.get("device"):
        facts.append(Fact("device", str(node["device"]), name, [name], str(node["device"]).lower()))
    if node.get("role"):
        facts.append(Fact("role", str(node["role"]), name, [name], str(node["role"]).lower()))
    for module in as_list(node.get("module")):
        facts.append(Fact("module", str(module), name, [name], str(module).lower()))
    bgp_as = as_dict(node.get("bgp")).get("as")
    if isinstance(bgp_as, int):
        facts.append(Fact("as", f"AS {bgp_as}", name, [name], f"as{bgp_as}", number=bgp_as))
    for vlan_name, vlan in as_dict(node.get("vlans")).items():
        vid = as_dict(vlan).get("id")
        facts.append(
            Fact(
                "vlan",
                f"VLAN {vlan_name}",
                f"{name}{f' · id {vid}' if vid is not None else ''}",
                [name],
                str(vlan_name).lower(),
                number=vid if isinstance(vid, int) else None,
            )
        )
    for vrf_name, vrf in as_dict(node.get("vrfs")).items():
        rd = as_dict(vrf).get("rd")
        facts.append(
            Fact("vrf", f"VRF {vrf_name}", f"{name}{f' · rd {rd}' if rd else ''}", [name], str(vrf_name).lower())
        )
    return facts + _address_facts(name, node)


def _merge(facts: list[Fact]) -> list[Fact]:
    """One hit per (kind, title) for shared facts — "module ospf" lists every
    node running OSPF once, instead of one row per node. Addresses and nodes
    stay individual."""
    merged: dict[tuple[str, str], Fact] = {}
    result: list[Fact] = []
    for fact in facts:
        if fact.kind in {"ip", "node"}:
            result.append(fact)
            continue
        key = (fact.kind, fact.title)
        if key in merged:
            existing = merged[key]
            existing.nodes = sorted({*existing.nodes, *fact.nodes}, key=natural_key)
        else:
            merged[key] = Fact(fact.kind, fact.title, "", list(fact.nodes), fact.text, fact.number)
            result.append(merged[key])
    for fact in merged.values():
        count = len(fact.nodes)
        fact.detail = (
            fact.nodes[0] if count == 1 else f"{count} nodes: {', '.join(fact.nodes[:6])}{'…' if count > 6 else ''}"
        )
    return result


def build_facts(transformed: dict[str, Any]) -> list[Fact]:
    facts: list[Fact] = []
    for name, node in sorted(as_dict(transformed.get("nodes")).items(), key=lambda item: natural_key(item[0])):
        facts.extend(_node_facts(str(name), as_dict(node)))
    for group, body in as_dict(transformed.get("groups")).items():
        members = [str(m) for m in (as_list(body) if isinstance(body, list) else as_list(as_dict(body).get("members")))]
        if members and not str(group).startswith("_"):
            facts.append(Fact("group", str(group), "", members, str(group).lower()))
    return _merge(facts)


_KIND_PREFIX = re.compile(rf"^({'|'.join(KINDS)}):\s*(.*)$", re.IGNORECASE)
_AS_QUERY = re.compile(r"^as\s*(\d+)$", re.IGNORECASE)


def _ip_matches(fact: Fact, query: str) -> int:
    """Rank of an address fact for an address/prefix query; 0 = no match."""
    if fact.address is None:
        return 0
    try:
        if "/" in query:
            network = ipaddress.ip_network(query, strict=False)
            return 2 if fact.address.version == network.version and fact.address.ip in network else 0
        address = ipaddress.ip_address(query)
    except ValueError:
        return 0
    if fact.address.version != address.version:
        return 0
    if fact.address.ip == address:
        return 3
    return 1 if address in fact.address.network and fact.address.network.prefixlen < fact.address.max_prefixlen else 0


def _is_address_query(query: str) -> bool:
    try:
        ipaddress.ip_network(query, strict=False)
    except ValueError:
        return False
    return any(sep in query for sep in ".:")


def _rank(fact: Fact, query: str, kind: str | None) -> int:
    if kind and fact.kind != kind:
        return 0
    if _is_address_query(query):
        return _ip_matches(fact, query) * 10
    if as_match := _AS_QUERY.match(query):
        return 30 if fact.kind == "as" and fact.number == int(as_match.group(1)) else 0
    if query.isdigit() and fact.number == int(query) and fact.kind in {"as", "vlan", "node"}:
        return 30
    text = query.lower()
    if fact.kind == "ip":
        return 5 if fact.text.startswith(text) else 0
    if fact.text == text:
        return 25
    if fact.text.startswith(text):
        return 15
    return 5 if text in fact.text else 0


def search(transformed: dict[str, Any], query: str) -> list[dict[str, Any]]:
    query = query.strip()
    kind: str | None = None
    if prefix := _KIND_PREFIX.match(query):
        kind, query = prefix.group(1).lower(), prefix.group(2).strip()
    if not query and not kind:
        return []
    ranked: list[tuple[int, int, Fact]] = []
    for index, fact in enumerate(build_facts(transformed)):
        score = 20 if kind and not query and fact.kind == kind else _rank(fact, query, kind)
        if score:
            ranked.append((-score, index, fact))
    ranked.sort(key=lambda item: item[:2])
    return [
        {"kind": fact.kind, "title": fact.title, "detail": fact.detail, "nodes": fact.nodes}
        for _score, _index, fact in ranked[:MAX_RESULTS]
    ]


def modules(transformed: dict[str, Any]) -> list[dict[str, Any]]:
    """Every module in the lab with the nodes running it (canvas filter chips)."""
    return [
        {"kind": fact.kind, "title": fact.title, "detail": fact.detail, "nodes": fact.nodes}
        for fact in build_facts(transformed)
        if fact.kind == "module"
    ]
