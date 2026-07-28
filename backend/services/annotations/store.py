"""The layout/UI sidecar store: ``<topology>.netlab-ui.json``.

This is the **only** place node positions and other view-state are persisted, so
the netlab ``topology.yml`` stays pure declarative intent (no coordinates) — the
behavior the user explicitly asked for ("handle placement like containerlab, in
an extra file"). clab-ui carries these back to us as the snapshot's
``annotations`` field.

Persisted view-state:
  - ``positions``: ``{node_name: {x, y}}`` from canvas drags
  - ``icons``:     ``{node_name: icon_id}`` overrides
  - ``collapsed``: list of group names currently collapsed (level-of-detail)
  - ``groupBoxes`` / ``notes``: free-form visual annotations
  - ``templates``: serialized Template definitions (a UI concept, not netlab YAML)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def sidecar_path(topology_path: str | Path) -> Path:
    p = Path(topology_path)
    return p.with_name(p.stem + ".netlab-ui.json")


def _empty() -> dict[str, Any]:
    return {
        "positions": {},
        "icons": {},
        "collapsed": [],
        "groupBoxes": [],
        "notes": [],
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


def load(topology_path: str | Path) -> dict[str, Any]:
    path = sidecar_path(topology_path)
    if not path.exists():
        return _empty()
    data = json.loads(path.read_text())
    return {**_empty(), **data}


def save(topology_path: str | Path, annotations: dict[str, Any]) -> None:
    path = sidecar_path(topology_path)
    path.write_text(json.dumps(annotations, indent=2, sort_keys=True))


def set_position(topology_path: str | Path, node: str, x: float, y: float) -> dict[str, Any]:
    """Persist a single node position (the hot path for canvas drags)."""
    ann = load(topology_path)
    ann["positions"][node] = {"x": x, "y": y}
    save(topology_path, ann)
    return ann


def set_icon(topology_path: str | Path, node: str, icon: str) -> dict[str, Any]:
    """Persist a node's icon (topoViewerRole) override so a custom-node icon
    survives snapshot rebuilds instead of falling back to the device kind."""
    ann = load(topology_path)
    ann.setdefault("icons", {})[node] = icon
    save(topology_path, ann)
    return ann


def remove_node(topology_path: str | Path, node_id: str) -> dict[str, Any]:
    """Drop every view-state entry that referenced a now-deleted node, so the
    canvas never renders orphaned positions/icons/memberships (the "annotations
    that shouldn't be there" the user reported). Mirrors the reconciliation
    ``TopologyHostCore`` does for renamed/removed nodes."""
    ann = load(topology_path)
    ann.get("positions", {}).pop(node_id, None)
    ann.get("icons", {}).pop(node_id, None)
    ann["nodeAnnotations"] = [n for n in ann.get("nodeAnnotations", []) if n.get("id") != node_id]
    save(topology_path, ann)
    return ann


def rename_node(topology_path: str | Path, old_id: str, new_id: str) -> dict[str, Any]:
    """Carry a node's view-state across a rename so positions/icons/membership
    follow the new name instead of orphaning under the old one."""
    if old_id == new_id:
        return load(topology_path)
    ann = load(topology_path)
    positions = ann.get("positions", {})
    if old_id in positions:
        positions[new_id] = positions.pop(old_id)
    icons = ann.get("icons", {})
    if old_id in icons:
        icons[new_id] = icons.pop(old_id)
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
