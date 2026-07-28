"""Source → transformed derivation inspector.

Netlab resolves a terse topology into a fully-expanded device model by layering
node settings over group settings over global defaults, then computing the rest
(addresses, ids, interface names). This module classifies each resolved node
attribute by *where its value came from*:

- **authored**  — written explicitly on the node in the source YAML
- **inherited** — supplied by a group the node belongs to, or a global default
- **computed**  — derived by netlab (not present in any authored layer)

Classification is best-effort intent, derived by comparing the source document
against the transformed model; it is not a re-implementation of netlab's
inheritance engine.
"""

from __future__ import annotations

from typing import Any

from services.lenses._helpers import as_dict as _dict
from services.lenses._helpers import as_list as _list

_MISSING = object()

# Curated, high-signal attributes. Deep computed arrays (interfaces, neighbors)
# are intentionally excluded — they are almost entirely netlab-computed and
# would drown the signal.
NODE_ATTRS: list[tuple[str, str]] = [
    ("device", "Device"),
    ("module", "Modules"),
    ("id", "Node ID"),
    ("role", "Role"),
    ("bgp.as", "BGP AS"),
    ("bgp.rr", "Route reflector"),
    ("bgp.router_id", "BGP router-id"),
    ("ospf.area", "OSPF area"),
    ("ospf.process", "OSPF process"),
    ("isis.area", "IS-IS area"),
    ("isis.type", "IS-IS level"),
    ("loopback.ipv4", "Loopback IPv4"),
    ("loopback.ipv6", "Loopback IPv6"),
    ("mgmt.ipv4", "Mgmt IPv4"),
]


def _get(container: Any, path: str) -> Any:
    # netlab accepts dotted-key shorthand at any level, so "bgp.as" may appear
    # either nested ({"bgp": {"as": ...}}) or as a literal "bgp.as" key. Resolve
    # both, trying every prefix split so mixed forms also work.
    if not isinstance(container, dict):
        return _MISSING
    if path in container:
        return container[path]
    parts = path.split(".")
    for split in range(1, len(parts)):
        head = ".".join(parts[:split])
        if head in container:
            result = _get(container[head], ".".join(parts[split:]))
            if result is not _MISSING:
                return result
    return _MISSING


def _present(container: Any, path: str) -> bool:
    return _get(container, path) is not _MISSING


def _stringify(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    if isinstance(value, dict):
        return ", ".join(sorted(str(key) for key in value))
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _node_groups(
    source: dict[str, Any], node_name: str, source_node: dict[str, Any], transformed_node: dict[str, Any]
) -> list[tuple[str, dict[str, Any]]]:
    groups = _dict(source.get("groups"))
    names: set[str] = set()
    for owner in (source_node, transformed_node):
        raw = _dict(owner).get("group")
        if isinstance(raw, str):
            names.add(raw)
        elif isinstance(raw, list):
            names.update(str(item) for item in raw)
    for group_name, raw_group in groups.items():
        members = _list(_dict(raw_group).get("members"))
        if node_name in members:
            names.add(str(group_name))
    return [(name, _dict(groups.get(name))) for name in sorted(names)]


def _classify(
    path: str,
    source_node: dict[str, Any],
    group_defs: list[tuple[str, dict[str, Any]]],
    global_defs: list[tuple[str, dict[str, Any]]],
) -> tuple[str, str | None]:
    if _present(source_node, path):
        return "authored", None
    for group_name, group_def in group_defs:
        if _present(group_def, path):
            return "inherited", f"group {group_name}"
    for label, container in global_defs:
        if _present(container, path):
            return "inherited", label
    return "computed", None


def classify_node(
    transformed: dict[str, Any],
    source: dict[str, Any],
    node_name: str,
) -> dict[str, Any]:
    transformed_node = _dict(_dict(transformed.get("nodes")).get(node_name))
    source_node = _dict(_dict(source.get("nodes")).get(node_name))
    group_defs = _node_groups(source, node_name, source_node, transformed_node)
    global_defs: list[tuple[str, dict[str, Any]]] = [
        ("global default", source),
        ("defaults", _dict(source.get("defaults"))),
    ]

    fields: list[dict[str, Any]] = []
    counts = {"authored": 0, "inherited": 0, "computed": 0}
    for path, label in NODE_ATTRS:
        value = _get(transformed_node, path)
        if value is _MISSING or value is None:
            continue
        origin, origin_source = _classify(path, source_node, group_defs, global_defs)
        counts[origin] += 1
        fields.append(
            {
                "path": path,
                "label": label,
                "value": _stringify(value),
                "origin": origin,
                "source": origin_source,
            }
        )
    return {
        "node": node_name,
        "fields": fields,
        "authored": counts["authored"],
        "inherited": counts["inherited"],
        "computed": counts["computed"],
        "groups": [name for name, _def in group_defs],
    }


def build_derivation(transformed: dict[str, Any], source: dict[str, Any] | None) -> dict[str, Any]:
    source = source or {}
    nodes = _dict(transformed.get("nodes"))
    node_rows = [classify_node(transformed, source, str(name)) for name in nodes]
    return {
        "available": bool(nodes) and bool(source.get("nodes")),
        "nodes": node_rows,
    }
