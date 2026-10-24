"""The layout/UI view-state store, split across two on-disk files per topology:

  - ``<topology-filename>.annotations.json`` — clab-ui's own file, in clab-ui's
    own format (:data:`_CLAB_KEYS`). Nothing netlab-gui-specific ever goes in
    here, so opening the lab in a plain containerlab VS Code / clab-ui viewer
    reads real data, and clab tooling writing back to this file can't silently
    drop netlab-gui state it doesn't know about.
  - ``<topology-stem>.netlab-ui.json`` — everything netlab-gui-only: template
    definitions, the custom-node catalog, level-of-detail collapse state, unit
    composition/provenance metadata.

This is the **only** place node positions and other view-state are persisted, so
the netlab ``topology.yml`` stays pure declarative intent (no coordinates) — the
behavior the user explicitly asked for ("handle placement like containerlab, in
an extra file"). Callers get one merged dict from :func:`load` and never need to
know which file a key belongs to — :func:`save` splits it back out.

A node's position and icon override live inside its ``nodeAnnotations`` entry
(``{id, groupId, position: {x, y}, icon}``) — clab-ui's own per-node shape.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# Keys that belong in clab-ui's own annotations.json — its real, documented
# ``TopologyAnnotations`` shape. Everything else is netlab-gui-only and goes in
# the ``.netlab-ui.json`` sidecar instead.
_CLAB_KEYS = {
    "nodeAnnotations",
    "edgeAnnotations",
    "freeTextAnnotations",
    "freeShapeAnnotations",
    "trafficRateAnnotations",
    "groupStyleAnnotations",
    "viewerSettings",
}


def clab_annotations_path(topology_path: str | Path) -> Path:
    """clab-ui's own annotations file — same naming convention clab-ui itself
    uses (e.g. ``lab.clab.yml.annotations.json``)."""
    p = Path(topology_path)
    return p.with_name(p.name + ".annotations.json")


def sidecar_path(topology_path: str | Path) -> Path:
    """netlab-gui's own view-state file — never opened/written by clab tooling."""
    p = Path(topology_path)
    return p.with_name(p.stem + ".netlab-ui.json")


def _empty() -> dict[str, Any]:
    return {
        "collapsed": [],
        "templates": [],
        "customNodes": [],
        "defaultNode": "",
        "freeTextAnnotations": [],
        "freeShapeAnnotations": [],
        "trafficRateAnnotations": [],
        "groupStyleAnnotations": [],
        # Per-node view-state in the clab-ui shape ({id, groupId, ...}). Canvas
        # group membership lives here, NOT in the netlab YAML's ``groups:``.
        "nodeAnnotations": [],
        "edgeAnnotations": [],
        "viewerSettings": {},
    }


def has_annotations(topology_path: str | Path) -> bool:
    """Whether either on-disk file exists (used for file-list badges)."""
    return clab_annotations_path(topology_path).exists() or sidecar_path(topology_path).exists()


def load(topology_path: str | Path) -> dict[str, Any]:
    data = _empty()
    clab_path = clab_annotations_path(topology_path)
    if clab_path.exists():
        data.update(json.loads(clab_path.read_text()))
    gui_path = sidecar_path(topology_path)
    if gui_path.exists():
        data.update(json.loads(gui_path.read_text()))
    return data


def save(topology_path: str | Path, annotations: dict[str, Any]) -> None:
    clab_data = {k: v for k, v in annotations.items() if k in _CLAB_KEYS}
    gui_data = {k: v for k, v in annotations.items() if k not in _CLAB_KEYS}
    clab_annotations_path(topology_path).write_text(json.dumps(clab_data, indent=2, sort_keys=True))
    sidecar_path(topology_path).write_text(json.dumps(gui_data, indent=2, sort_keys=True))


def get_node_annotation(ann: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    """The ``nodeAnnotations`` entry for ``node_id``, or ``None`` if it has none."""
    return next((n for n in ann.get("nodeAnnotations", []) if isinstance(n, dict) and n.get("id") == node_id), None)


def ensure_node_annotation(ann: dict[str, Any], node_id: str) -> dict[str, Any]:
    """The ``nodeAnnotations`` entry for ``node_id``, creating an empty one
    (appended to the list) if none exists yet."""
    entry = get_node_annotation(ann, node_id)
    if entry is None:
        entry = {"id": node_id}
        ann.setdefault("nodeAnnotations", []).append(entry)
    return entry


def set_position(topology_path: str | Path, node: str, x: float, y: float) -> dict[str, Any]:
    """Persist a single node position (the hot path for canvas drags)."""
    ann = load(topology_path)
    ensure_node_annotation(ann, node)["position"] = {"x": x, "y": y}
    save(topology_path, ann)
    return ann


def set_icon(topology_path: str | Path, node: str, icon: str) -> dict[str, Any]:
    """Persist a node's icon (topoViewerRole) override so a custom-node icon
    survives snapshot rebuilds instead of falling back to the device kind."""
    ann = load(topology_path)
    ensure_node_annotation(ann, node)["icon"] = icon
    save(topology_path, ann)
    return ann


def remove_node(topology_path: str | Path, node_id: str) -> dict[str, Any]:
    """Drop every view-state entry that referenced a now-deleted node, so the
    canvas never renders orphaned positions/icons/memberships (the "annotations
    that shouldn't be there" the user reported). Mirrors the reconciliation
    ``TopologyHostCore`` does for renamed/removed nodes."""
    ann = load(topology_path)
    ann["nodeAnnotations"] = [n for n in ann.get("nodeAnnotations", []) if n.get("id") != node_id]
    save(topology_path, ann)
    return ann


def rename_node(topology_path: str | Path, old_id: str, new_id: str) -> dict[str, Any]:
    """Carry a node's view-state across a rename so positions/icons/membership
    follow the new name instead of orphaning under the old one."""
    if old_id == new_id:
        return load(topology_path)
    ann = load(topology_path)
    for n in ann.get("nodeAnnotations", []):
        if n.get("id") == old_id:
            n["id"] = new_id
    save(topology_path, ann)
    return ann


def set_node_group(topology_path: str | Path, node_id: str, group_id: str | None) -> dict[str, Any]:
    """Set/clear a single node's canvas group membership in the sidecar
    (clab-ui's ``nodeAnnotations[].groupId`` model). Never touches the YAML."""
    ann = load(topology_path)
    node_anns = ann.get("nodeAnnotations", [])
    existing = next((n for n in node_anns if n.get("id") == node_id), None)
    if existing is not None:
        if group_id:
            existing["groupId"] = group_id
        else:
            existing.pop("groupId", None)
            existing.pop("group", None)
    elif group_id:
        node_anns.append({"id": node_id, "groupId": group_id})
    ann["nodeAnnotations"] = node_anns
    save(topology_path, ann)
    return ann


def set_collapsed(topology_path: str | Path, group: str, collapsed: bool) -> dict[str, Any]:
    ann = load(topology_path)
    current = set(ann.get("collapsed", []))
    current.add(group) if collapsed else current.discard(group)
    ann["collapsed"] = sorted(current)
    save(topology_path, ann)
    return ann
