"""Translate clab-ui canvas commands into either annotation writes or netlab
source-model mutations.

Two classes of command:

* **layout** (move/position, collapse/expand) → write to the annotations sidecar
  *only*. These never touch the netlab YAML, satisfying "drag like clab but keep
  coordinates out of the topology". This path is fully supported from milestone 1
  — it needs no inverse mapping.

* **structural** (add/remove node, add/remove link, set device, assign to group)
  → mutate the :class:`Topology` model, reserialize to YAML. This is the harder
  "inverse transform" and is filled in over milestone 5; the dispatch table and
  the straightforward cases are here.

The exact command verbs clab-ui emits must be reconciled with
``@srl-labs/app-contract`` once the package is wired in; the verbs below are the
documented/expected set and are easy to extend.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from services import annotations as ann_store
from services.model import serialize
from services.model.topology import Group, Link, Node, Topology


def load_topology(path: str) -> Topology:
    p = Path(path)
    if p.exists():
        return serialize.from_yaml(p.read_text())
    return Topology(name=p.stem)


def save_topology(path: str, topo: Topology) -> None:
    Path(path).write_text(serialize.to_yaml(topo))


# True  -> structural (caller should bump the session revision)
# False -> layout-only (no revision change)
def apply(path: str, command: dict[str, Any]) -> bool:
    verb = command.get("type") or command.get("verb") or command.get("command")
    handler = _HANDLERS.get(verb)
    if handler is None:
        raise ValueError(f"unsupported command: {verb!r}")

    # clab-ui sends commands with a nested payload structure:
    # { command: "deleteNode", payload: { id: "r1" } }
    # Flatten it for easier handling
    if "payload" in command and isinstance(command["payload"], dict):
        flat_command = {**command, **command["payload"]}
    else:
        flat_command = command

    return handler(path, flat_command)


def _batch(path: str, cmd: dict[str, Any]) -> bool:
    """Execute multiple commands in sequence. Returns True if any were structural."""
    commands = cmd.get("commands", [])
    any_structural = False
    for sub_cmd in commands:
        structural = apply(path, sub_cmd)
        any_structural = any_structural or structural
    return any_structural


# --------------------------- layout commands ------------------------------- #
def _move(path: str, cmd: dict[str, Any]) -> bool:
    pos = cmd.get("position", {})
    ann_store.set_position(path, cmd["id"], pos.get("x", 0), pos.get("y", 0))
    return False


def _save_positions(path: str, cmd: dict[str, Any]) -> bool:
    payload = cmd.get("payload", [])
    positions = payload.get("positions", []) if isinstance(payload, dict) else payload

    for entry in positions:
        pos = entry.get("position") or {}
        node_id = entry.get("id")
        if node_id:
            ann_store.set_position(path, node_id, pos.get("x", 0), pos.get("y", 0))

    if isinstance(payload, dict):
        annotations = payload.get("annotations")
        if annotations:
            _set_annotations(path, {"payload": annotations})
    return False


def _collapse(path: str, cmd: dict[str, Any]) -> bool:
    ann_store.set_collapsed(path, cmd["group"], bool(cmd.get("collapsed", True)))
    return False


# ------------------------- structural commands ----------------------------- #
def _set_yaml_content(path: str, cmd: dict[str, Any]) -> bool:
    """Replace the entire YAML file content (from direct YAML editing)."""
    content = cmd.get("content", "")
    Path(path).write_text(content)
    return True


def _set_annotations_content(path: str, cmd: dict[str, Any]) -> bool:
    """Replace the annotations content (from direct JSON editing). Routes
    through the normal save path so the result still splits across clab-ui's
    own annotations file and the netlab-gui-only sidecar."""
    content = cmd.get("content", "").strip() or "{}"
    ann_store.save(path, json.loads(content))
    return False


def _add_node(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    if topo.node(cmd["id"]) is None:
        # `device` may be sent directly or nested inside `extraData.kind` (netlab-gui palette drops).
        # Duplicating/pasting an existing node round-trips `extraData.kind` too, but there it's
        # just the canvas's *resolved* device (clab-ui always needs a concrete kind to pick an
        # icon — see snapshot.py's device/kind reconciliation), not something the user actually
        # chose. If it merely matches the lab-wide default, drop it so the clone keeps inheriting
        # instead of pinning a redundant explicit value.
        device = cmd.get("device") or (cmd.get("extraData") or {}).get("kind") or None
        default_device = topo.defaults.get("device")
        if device is not None and default_device is not None and device == default_device:
            device = None
        # Duplicating/pasting an existing node carries its full declarative
        # attrs (module config, mgmt, anything the user set) under
        # extraData.netlabAttrs — see snapshot.py. Fresh nodes from the
        # palette never set this, so they still start blank. No attribute
        # names are hardcoded here; whatever the source node had is copied.
        source_attrs = (cmd.get("extraData") or {}).get("netlabAttrs")
        attrs = copy.deepcopy(source_attrs) if isinstance(source_attrs, dict) else {}
        topo.nodes.append(Node(name=cmd["id"], device=device, attrs=attrs))
    save_topology(path, topo)
    # Position (if the canvas placed it) is layout, not topology.
    if "position" in cmd:
        pos = cmd["position"]
        ann_store.set_position(path, cmd["id"], pos.get("x", 0), pos.get("y", 0))
    # A custom-node template carries its icon as topoViewerRole; persist it to the
    # sidecar so the icon survives snapshot rebuilds instead of reverting to kind.
    extra = cmd.get("extraData") or {}
    icon = extra.get("topoViewerRole") or extra.get("icon")
    if isinstance(icon, str) and icon:
        ann_store.set_icon(path, cmd["id"], icon)
    return True


def _remove_node(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    nid = cmd["id"]
    topo.nodes = [n for n in topo.nodes if n.name != nid]
    topo.links = [lnk for lnk in topo.links if nid not in lnk.endpoints]
    for g in topo.groups:
        g.members = [m for m in g.members if m != nid]
    # Sweep the explicit ``interfaces:`` form of any *surviving* link: a stale
    # entry can reference the deleted node without listing it in ``endpoints``
    # (e.g. introduced via a group), which the endpoint filter above misses. Drop
    # just that interface; if the link collapses below two endpoints, remove it.
    surviving: list[Link] = []
    for lnk in topo.links:
        interfaces = lnk.attrs.get("interfaces")
        if isinstance(interfaces, list):
            cleaned = [i for i in interfaces if not (isinstance(i, dict) and i.get("node") == nid)]
            if len(cleaned) != len(interfaces):
                if cleaned:
                    lnk.attrs["interfaces"] = cleaned
                else:
                    lnk.attrs.pop("interfaces", None)
                lnk.endpoints = [ep for ep in lnk.endpoints if ep != nid]
        if len(lnk.endpoints) >= 2:
            surviving.append(lnk)
    topo.links = surviving
    save_topology(path, topo)
    # Cascade-clean the sidecar so no orphaned position/icon/membership lingers.
    ann_store.remove_node(path, nid)
    return True


def _set_device(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    node = topo.node(cmd["id"])
    if node is not None:
        node.device = cmd.get("device")
    save_topology(path, topo)
    return True


def _add_link(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    topo.links.append(Link(endpoints=[cmd["source"], cmd["target"]]))
    save_topology(path, topo)
    return True


def _edit_link(path: str, cmd: dict[str, Any]) -> bool:
    """Persist per-endpoint interface names typed in clab-ui's Link Editor.

    netlab assigns interface names automatically, so an unpinned link stays the
    compact ``a-b`` string. When the user pins a name we promote the link to the
    explicit ``interfaces:`` form and write ``ifname`` per endpoint, preserving
    any other per-interface attributes already on the link.
    """
    topo = load_topology(path)
    source = cmd.get("source")
    target = cmd.get("target")
    pair = {source, target}

    link = next((lnk for lnk in topo.links if set(lnk.endpoints) == pair), None)
    if link is None:
        return False

    iface_by_node = {
        source: (cmd.get("sourceEndpoint") or "").strip(),
        target: (cmd.get("targetEndpoint") or "").strip(),
    }

    existing = {i.get("node"): dict(i) for i in (link.attrs.get("interfaces") or []) if isinstance(i, dict)}
    interfaces: list[dict[str, Any]] = []
    for ep in link.endpoints:
        entry = existing.get(ep, {})
        entry["node"] = ep
        ifname = iface_by_node.get(ep, "")
        if ifname:
            entry["ifname"] = ifname
        else:
            entry.pop("ifname", None)
        interfaces.append(entry)

    # Keep the explicit form only when something beyond the bare node remains;
    # otherwise drop back to the compact ``a-b`` string.
    if any(len(e) > 1 for e in interfaces):
        link.attrs["interfaces"] = interfaces
    else:
        link.attrs.pop("interfaces", None)

    save_topology(path, topo)
    return True


def _remove_link(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    pair = {cmd["source"], cmd["target"]}
    topo.links = [lnk for lnk in topo.links if set(lnk.endpoints) != pair]
    save_topology(path, topo)
    return True


def _assign_group(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    gname = cmd["group"]
    group = topo.group(gname)
    if group is None:
        group = Group(name=gname)
        topo.groups.append(group)
    if cmd["id"] not in group.members:
        group.members.append(cmd["id"])
    save_topology(path, topo)
    return True


def _membership_list(payload: Any) -> list[dict[str, Any]]:
    """clab-ui sends ``setNodeGroupMemberships`` either as a bare list of
    ``{nodeId, groupId}`` or wrapped in ``{memberships: [...]}``."""
    if isinstance(payload, dict):
        return payload.get("memberships", []) or []
    if isinstance(payload, list):
        return payload
    return []


def _set_node_group_memberships(path: str, cmd: dict[str, Any]) -> bool:
    """Canvas group membership is *view-state*: it lives in the sidecar's
    ``nodeAnnotations[].groupId`` (clab-ui's model), never in the netlab YAML's
    ``groups:`` (which is a config-module concept owned by the authoring panel).
    Keeping these separate is what stops the canvas from spawning bogus netlab
    groups / desyncing on every drag."""
    for entry in _membership_list(cmd.get("payload")):
        node_id = entry.get("nodeId") or entry.get("id")
        if node_id:
            ann_store.set_node_group(path, node_id, entry.get("groupId"))
    return False


def _set_annotations(path: str, cmd: dict[str, Any]) -> bool:
    """Save UI annotations (free text, free shapes, groups, traffic rates).
    This is layout-only and doesn't affect the topology structure."""
    payload = cmd.get("payload", {})
    ann = ann_store.load(path)

    # Update annotation fields from payload
    if "freeTextAnnotations" in payload:
        ann["freeTextAnnotations"] = payload["freeTextAnnotations"]
    if "freeShapeAnnotations" in payload:
        ann["freeShapeAnnotations"] = payload["freeShapeAnnotations"]
    if "trafficRateAnnotations" in payload:
        ann["trafficRateAnnotations"] = payload["trafficRateAnnotations"]
    if "groupStyleAnnotations" in payload:
        ann["groupStyleAnnotations"] = payload["groupStyleAnnotations"]

    ann_store.save(path, ann)
    return False


def _set_annotations_with_memberships(path: str, cmd: dict[str, Any]) -> bool:
    """Save group-style annotations and node memberships together — both are
    sidecar view-state (clab-ui's model), so the netlab YAML is untouched."""
    payload = cmd.get("payload", {})

    annotations = payload.get("annotations", {})
    if annotations:
        _set_annotations(path, {"payload": annotations})

    for entry in payload.get("memberships", []) or []:
        node_id = entry.get("nodeId") or entry.get("id")
        if node_id:
            ann_store.set_node_group(path, node_id, entry.get("groupId"))
    return False


def _set_edge_annotations(path: str, cmd: dict[str, Any]) -> bool:
    """Save edge annotations (labels, colors, etc.)."""
    payload = cmd.get("payload", [])
    ann = ann_store.load(path)
    ann["edgeAnnotations"] = payload
    ann_store.save(path, ann)
    return False


def _set_viewer_settings(path: str, cmd: dict[str, Any]) -> bool:
    """Save viewer settings (zoom, pan, etc.)."""
    payload = cmd.get("payload", {})
    ann = ann_store.load(path)
    ann["viewerSettings"] = payload
    ann_store.save(path, ann)
    return False


def _set_node_group_membership(path: str, cmd: dict[str, Any]) -> bool:
    """Set a single node's canvas group membership (sidecar view-state only)."""
    payload = cmd.get("payload", {})
    node_id = payload.get("nodeId") or payload.get("id")
    if not node_id:
        return False
    ann_store.set_node_group(path, node_id, payload.get("groupId"))
    return False


def _edit_node(path: str, cmd: dict[str, Any]) -> bool:
    topo = load_topology(path)
    node_id = cmd.get("id")
    old_name = cmd.get("oldName")

    node_to_update = None
    if old_name:
        node_to_update = topo.node(old_name)
        if node_to_update:
            node_to_update.name = cmd.get("name", node_id)
            # rename inside links
            for link in topo.links:
                link.endpoints = [node_to_update.name if ep == old_name else ep for ep in link.endpoints]
                for iface in link.attrs.get("interfaces", []) or []:
                    if isinstance(iface, dict) and iface.get("node") == old_name:
                        iface["node"] = node_to_update.name
            # rename inside groups
            for group in topo.groups:
                group.members = [node_to_update.name if m == old_name else m for m in group.members]
    else:
        node_to_update = topo.node(node_id)

    if node_to_update is None:
        return False

    extra_data = dict(cmd.get("extraData", {}))

    # device/kind mapping
    if "device" in extra_data:
        node_to_update.device = extra_data.pop("device") or None
    elif "kind" in extra_data:
        node_to_update.device = extra_data.pop("kind") or None

    ui_keys = {
        "topoViewerRole",
        "iconColor",
        "iconCornerRadius",
        "interfacePattern",
        "labelPosition",
        "direction",
        "labelBackgroundColor",
        "x",
        "y",
    }

    ann = ann_store.load(path)
    node_name = node_to_update.name

    if old_name and old_name != node_name:
        for entry in ann.get("nodeAnnotations", []):
            if entry.get("id") == old_name:
                entry["id"] = node_name

    for key in list(extra_data.keys()):
        val = extra_data.pop(key)
        if key in ui_keys:
            if key == "topoViewerRole":
                if val:
                    ann_store.ensure_node_annotation(ann, node_name)["icon"] = val
                else:
                    entry = ann_store.get_node_annotation(ann, node_name)
                    if entry:
                        entry.pop("icon", None)
        else:
            if val is not None and val != "":
                node_to_update.attrs[key] = val
            else:
                node_to_update.attrs.pop(key, None)

    ann_store.save(path, ann)
    save_topology(path, topo)
    return True


# clab-ui lab-settings mgmt field -> netlab `management:` key. Only fields with a
# clean netlab equivalent are mapped; containerlab-only knobs (ipv4-range,
# ipv6-gw, external-access, driver-opts) are intentionally dropped rather than
# written as invalid netlab.
_MGMT_MAP = {
    "network": "_network",
    "ipv4-subnet": "ipv4",
    "ipv6-subnet": "ipv6",
    "ipv4-gw": "gateway",
    "mtu": "mtu",
    "bridge": "_bridge",
}


def _set_lab_settings(path: str, cmd: dict[str, Any]) -> bool:
    """Apply lab-settings (clab-ui's top-level name/prefix/mgmt) to the netlab
    topology. ``name`` -> ``topology.name``; ``mgmt`` -> netlab ``management:``.
    ``prefix`` is a containerlab concept with no netlab analogue, so it is
    ignored."""
    topo = load_topology(path)

    name = cmd.get("name")
    if name:
        topo.name = name

    mgmt = cmd.get("mgmt")
    if isinstance(mgmt, dict):
        management: dict[str, Any] = {}
        for src, dst in _MGMT_MAP.items():
            val = mgmt.get(src)
            if val not in (None, ""):
                management[dst] = val
        if management:
            topo.attrs["management"] = management
        elif "management" in topo.attrs:
            # Settings cleared -> drop the key so we don't leave a stale block.
            del topo.attrs["management"]

    save_topology(path, topo)
    return True


_HANDLERS = {
    "batch": _batch,
    "n": _set_lab_settings,  # current @srl-labs/clab-ui verb
    "setLabSettings": _set_lab_settings,  # older bundle verb (alias)
    "move": _move,
    "position": _move,
    "savePositions": _save_positions,
    "savePositionsWithMemberships": _save_positions,  # alias with memberships handling
    "savePositionsAndAnnotations": _save_positions,  # alias
    "collapse": _collapse,
    "setYamlContent": _set_yaml_content,
    "setAnnotationsContent": _set_annotations_content,
    "addNode": _add_node,
    "removeNode": _remove_node,
    "deleteNode": _remove_node,  # alias
    "editNode": _edit_node,
    "setDevice": _set_device,
    "addLink": _add_link,
    "editLink": _edit_link,
    "updateLink": _edit_link,  # alias
    "removeLink": _remove_link,
    "deleteLink": _remove_link,  # alias
    "assignGroup": _assign_group,
    "setNodeGroupMemberships": _set_node_group_memberships,
    "setAnnotations": _set_annotations,
    "setAnnotationsWithMemberships": _set_annotations_with_memberships,
    "setEdgeAnnotations": _set_edge_annotations,
    "setViewerSettings": _set_viewer_settings,
    "setNodeGroupMembership": _set_node_group_membership,
}
