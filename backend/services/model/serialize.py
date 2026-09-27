"""Round-trip serialization between the :mod:`topology` source model and netlab
YAML.

We use ``ruamel.yaml`` so that hand-written comments and formatting survive an
edit cycle (load -> mutate one field -> dump should not reflow the whole file).
The (de)serializers are deliberately lossless for attributes we don't model:
unknown keys ride along in ``attrs``.

Templates are **not** emitted into the netlab YAML — they are a UI concept.
They are persisted separately (alongside the annotations sidecar). ``to_yaml``
therefore intentionally drops ``topology.templates``.
"""

from __future__ import annotations

import copy
import difflib
import io
import json
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from .topology import Group, Link, Node, Topology

_yaml = YAML()
_yaml.preserve_quotes = True
_yaml.indent(mapping=2, sequence=4, offset=2)
_yaml.version = None
_yaml.explicit_start = False

# Top-level keys we model explicitly; everything else is preserved in attrs.
_KNOWN_TOP = {"name", "provider", "defaults", "nodes", "links", "groups"}
_TOP_LEVEL_KEY_ORDER = [
    "name",
    "provider",
    "plugin",
    "module",
    "defaults",
    "addressing",
    "prefix",
    "groups",
    "nodes",
    "links",
    "vlans",
    "vrfs",
    "tools",
    "validate",
    "version",
]
_TOP_LEVEL_ORDER_INDEX = {k: i for i, k in enumerate(_TOP_LEVEL_KEY_ORDER)}
# Per-node keys we model explicitly.
_KNOWN_NODE = {"device"}
# Per-group keys we model explicitly.
_KNOWN_GROUP = {"members", "module"}


# --------------------------------------------------------------------------- #
# parse: dict / yaml -> model
# --------------------------------------------------------------------------- #
def from_dict(data: dict[str, Any] | None) -> Topology:
    data = dict(data or {})
    topo = Topology(
        name=data.get("name", "lab"),
        provider=data.get("provider"),
        defaults=dict(data.get("defaults") or {}),
    )
    topo.nodes = _parse_nodes(data.get("nodes"))
    node_names = {n.name for n in topo.nodes}
    topo.links = [_parse_link(item, node_names) for item in (data.get("links") or [])]
    topo.groups = _parse_groups(data.get("groups"))
    topo.attrs = {k: v for k, v in data.items() if k not in _KNOWN_TOP}

    existing_nodes = {n.name for n in topo.nodes}
    existing_groups = {g.name for g in topo.groups}
    for link in topo.links:
        for ep in link.endpoints:
            if ep and ep not in existing_nodes and ep not in existing_groups:
                topo.nodes.append(Node(name=ep))
                existing_nodes.add(ep)

    return topo


def from_yaml(text: str) -> Topology:
    data = _yaml.load(text) or {}
    # ruamel's round-trip loader remembers a document's ``%YAML`` directive on
    # the *shared* YAML() instance (``_yaml.version``), not per-document. Left
    # alone, loading one file that happens to carry the directive (e.g. a
    # cloned netlab-examples lab) would leak it into every later dump for the
    # rest of the process — stamping "%YAML 1.1" onto unrelated topologies
    # that never had it. Reset it after every load so dumps stay directive-free.
    _yaml.version = None
    topo = from_dict(data)
    if isinstance(data, CommentedMap):
        # A private copy: the model shares nested objects with ``data`` and may
        # mutate them, while the merge in to_yaml needs the file as loaded.
        topo.source = copy.deepcopy(data)
    return topo


def _parse_nodes(raw: Any) -> list[Node]:
    nodes: list[Node] = []
    if raw is None:
        return nodes
    # netlab accepts both a mapping {name: {...}} and a list [name, {name: {...}}].
    if isinstance(raw, dict):
        items = raw.items()
    else:
        items = []
        for entry in raw:
            if isinstance(entry, str):
                items.append((entry, None))
            elif isinstance(entry, dict) and len(entry) == 1:
                items.append(next(iter(entry.items())))
            elif isinstance(entry, dict):
                items.append((entry.get("name"), entry))
    for name, body in items:
        body = dict(body or {})
        nodes.append(
            Node(
                name=name,
                device=body.get("device"),
                attrs={k: v for k, v in body.items() if k not in _KNOWN_NODE | {"name"}},
            )
        )
    return nodes


def _parse_link(item: Any, node_names: set[str]) -> Link:
    if isinstance(item, str):
        return Link(endpoints=_split_link_string(item))
    if isinstance(item, list):
        # A bare list of endpoints, e.g. [r1, r2, r3] (a LAN segment).
        return Link(endpoints=[_endpoint_name(e) for e in item])
    if isinstance(item, dict):
        if "interfaces" in item:
            endpoints = _endpoints_from_dict(item)
            has_rich_interfaces = False
            for iface in item.get("interfaces") or []:
                if isinstance(iface, dict) and any(k != "node" for k in iface):
                    has_rich_interfaces = True
                    break

            attrs = {}
            for k, v in item.items():
                if k == "interfaces":
                    if has_rich_interfaces:
                        attrs["interfaces"] = v
                else:
                    attrs[k] = v
            return Link(endpoints=endpoints, attrs=attrs)
        else:
            # Dictionary shortcut format:
            # - r1:
            #     vlan.access: red
            #   s1:
            #   vlan.trunk: [red]
            endpoints: list[str] = []
            interfaces: list[dict[str, Any]] = []
            attrs: dict[str, Any] = {}
            has_rich_interfaces = False

            for k, v in item.items():
                is_node = k in node_names
                if not is_node and "." not in k:
                    # check against known link attributes
                    known_link_attributes = {
                        "type",
                        "role",
                        "prefix",
                        "pool",
                        "mtu",
                        "unnumbered",
                        "bandwidth",
                        "bridge",
                        "disable",
                        "shutdown",
                        "name",
                        "vlan_name",
                        "vlan",
                        "gateway",
                        "ospf",
                        "bgp",
                        "isis",
                        "bfd",
                        "dhcp",
                        "eigrp",
                        "evpn",
                        "lag",
                        "mpls",
                        "ripv2",
                        "routing",
                        "sr",
                        "srv6",
                        "stp",
                        "vxlan",
                    }
                    if k not in known_link_attributes:
                        is_node = True

                if is_node:
                    endpoints.append(k)
                    iface_dict = {"node": k}
                    if isinstance(v, dict):
                        for ik, iv in v.items():
                            iface_dict[ik] = iv
                        has_rich_interfaces = True
                    interfaces.append(iface_dict)
                else:
                    attrs[k] = v

            if has_rich_interfaces:
                attrs["interfaces"] = interfaces
            return Link(endpoints=endpoints, attrs=attrs)
    return Link()


def _split_link_string(s: str) -> list[str]:
    return [p.strip() for p in s.split("-") if p.strip()]


def _endpoints_from_dict(item: dict[str, Any]) -> list[str]:
    ifaces = item.get("interfaces")
    if isinstance(ifaces, list):
        return [_endpoint_name(e) for e in ifaces]
    return []


def _endpoint_name(e: Any) -> str:
    if isinstance(e, str):
        return e
    if isinstance(e, dict):
        return e.get("node", "")
    return str(e)


def _parse_groups(raw: Any) -> list[Group]:
    groups: list[Group] = []
    for name, body in dict(raw or {}).items():
        body = dict(body or {})
        groups.append(
            Group(
                name=name,
                members=list(body.get("members") or []),
                module=list(body.get("module") or []),
                attrs={k: v for k, v in body.items() if k not in _KNOWN_GROUP},
            )
        )
    return groups


# --------------------------------------------------------------------------- #
# emit: model -> dict / yaml
# --------------------------------------------------------------------------- #
def to_dict(topo: Topology) -> dict[str, Any]:
    nodes: dict[str, Any] = {}
    for n in topo.nodes:
        body: dict[str, Any] = {}
        if n.device:
            body["device"] = n.device
        body.update(n.attrs)
        nodes[n.name] = body or None

    links: list[Any] = []
    for link in topo.links:
        links.append(_emit_link(link))

    groups: dict[str, Any] = {}
    for g in topo.groups:
        body = {}
        if g.members:
            body["members"] = list(g.members)
        if g.module:
            body["module"] = list(g.module)
        body.update(g.attrs)
        groups[g.name] = body
    if groups:
        groups_value: dict[str, Any] | None = groups
    else:
        groups_value = None

    keyed_values: dict[str, Any] = {"name": topo.name}
    if topo.provider:
        keyed_values["provider"] = topo.provider
    if topo.defaults:
        keyed_values["defaults"] = topo.defaults
    if groups_value:
        keyed_values["groups"] = groups_value
    if nodes:
        keyed_values["nodes"] = nodes
    if links:
        keyed_values["links"] = links

    # Preserve unmodeled top-level attributes, but emit common netlab keys in a
    # stable order so entries like plugin/module do not drift to the bottom.
    for key, value in topo.attrs.items():
        keyed_values[key] = value

    def _key_sort_index(key: str) -> int:
        if key in _TOP_LEVEL_ORDER_INDEX:
            return _TOP_LEVEL_ORDER_INDEX[key]
        prefix = key.split(".")[0]
        if prefix in _TOP_LEVEL_ORDER_INDEX:
            return _TOP_LEVEL_ORDER_INDEX[prefix]
        return len(_TOP_LEVEL_KEY_ORDER)

    out: dict[str, Any] = {}
    for key in sorted(keyed_values, key=_key_sort_index):
        out[key] = keyed_values[key]
    return out


def _emit_link(link: Link) -> Any:
    # Emit the compact ``a-b`` string when it is a plain two-endpoint link with
    # no extra attributes; otherwise emit the explicit interfaces form.
    if not link.attrs and len(link.endpoints) == 2:
        return "-".join(link.endpoints)
    if not link.attrs:
        return list(link.endpoints)

    body: dict[str, Any] = {}
    if "interfaces" in link.attrs:
        body["interfaces"] = link.attrs["interfaces"]
    else:
        body["interfaces"] = [{"node": e} for e in link.endpoints]

    for k, v in link.attrs.items():
        if k != "interfaces":
            body[k] = v
    return body


def to_yaml(topo: Topology) -> str:
    data: Any = to_dict(topo)
    if isinstance(topo.source, CommentedMap):
        # Merge into the document the model was loaded from: only what changed
        # is rewritten, so comments, flow-style lists and key order elsewhere
        # in the file survive a UI edit.
        doc = copy.deepcopy(topo.source)
        _merge_map(doc, data, top_level=True)
        data = doc
    buf = io.StringIO()
    _yaml.dump(data, buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# merge: apply a freshly emitted dict onto the loaded ruamel document
# --------------------------------------------------------------------------- #


def _equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    try:
        return bool(a == b)
    except Exception:  # noqa: BLE001 — exotic scalar types: treat as changed
        return False


def _item_key(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def _merge_value(container: Any, key: Any, old: Any, new: Any) -> None:
    if _equal(old, new):
        return
    if isinstance(old, CommentedMap) and isinstance(new, dict):
        _merge_map(old, new)
    elif isinstance(old, CommentedSeq) and isinstance(new, list):
        _merge_seq(old, new)
    else:
        container[key] = new


def _merge_map(doc: CommentedMap, new: dict[str, Any], top_level: bool = False) -> None:
    for key in [k for k in doc if k not in new]:
        del doc[key]
    for key, value in new.items():
        if key in doc:
            old = doc[key]
            # `nodes: [r1, r2]` stays a list while no node has attributes.
            if (
                top_level
                and key == "nodes"
                and isinstance(old, CommentedSeq)
                and isinstance(value, dict)
                and all(isinstance(item, str) for item in old)
                and all(not body for body in value.values())
            ):
                value = list(value)
            _merge_value(doc, key, old, value)
        else:
            doc[key] = value
    if top_level:
        # Keep to_dict's canonical top-level order (plugin/module before the
        # blocks that use them). Comments ride along: ruamel attaches them to
        # their key, not to a position.
        for key in list(new):
            doc.move_to_end(key)


def _merge_seq(doc: CommentedSeq, new: list[Any]) -> None:
    matcher = difflib.SequenceMatcher(
        a=[_item_key(item) for item in doc], b=[_item_key(item) for item in new], autojunk=False
    )
    # Back to front, so earlier indices stay valid while editing in place.
    for tag, i1, i2, j1, j2 in reversed(matcher.get_opcodes()):
        if tag == "equal":
            continue
        if tag == "replace" and i2 - i1 == j2 - j1:
            for offset in range(i2 - i1):
                _merge_value(doc, i1 + offset, doc[i1 + offset], new[j1 + offset])
            continue
        for index in range(i2 - 1, i1 - 1, -1):
            del doc[index]
        for offset, item in enumerate(new[j1:j2]):
            doc.insert(i1 + offset, item)
