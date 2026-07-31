"""Drop-placement layout math for unit instantiation.

When a unit is dropped onto the canvas (or expanded xN), this computes where
each of its nodes — and any nested included units — should land, reusing each
unit's own saved canvas state (recentered on the drop point) so a dropped
room looks like the room the user drew: layout, group boxes with their
colors, and icon overrides.
"""

from __future__ import annotations

from typing import Any

_SPACING = 140.0


def instance_layout(
    units: dict[str, dict[str, Any]],
    template_name: str,
    count: int,
    prefix: str,
    origin: dict[str, Any],
) -> dict[str, tuple[float, float]]:
    """Positions for the nodes an instantiate call will create (see
    :func:`instance_annotations` for the full view-state)."""
    out = instance_annotations(units, template_name, count, prefix, origin)
    return {n["id"]: (n["position"]["x"], n["position"]["y"]) for n in out["nodeAnnotations"] if n.get("position")}


def instance_annotations(
    units: dict[str, dict[str, Any]],
    template_name: str,
    count: int,
    prefix: str,
    origin: dict[str, Any],
) -> dict[str, Any]:
    """Everything an instantiate call should stamp into the lab's sidecar for
    the freshly-created instances, reusing each unit's saved canvas state
    (recentered on the drop point) so a dropped room looks like the room the
    user drew — layout, group boxes with their colors, and icon overrides.

    Returns ``{"nodeAnnotations": [{id, position, icon, groupId}, ...],
    "groupStyleAnnotations": [...]}`` (clab-ui's own per-node shape) with every
    id prefixed by its instance name.

    Mirrors the instance naming of ``services.model.templates`` exactly:
    top-level instances ``<prefix>`` / ``<prefix>1..N``, child instances
    ``<inst>_<child>`` / ``<inst>_<child>1..M``, nodes ``<inst>_<node>``.
    """
    out: dict[str, Any] = {
        "nodeAnnotations": [],
        "groupStyleAnnotations": [],
    }
    ox, oy = float(origin.get("x", 0)), float(origin.get("y", 0))
    for i in range(1, count + 1):
        inst = prefix if count == 1 else f"{prefix}{i}"
        width, _ = _footprint(units, template_name)
        _place_instance(units, template_name, inst, ox + (i - 1) * (width + _SPACING), oy, out)
    return out


def _own_layout(unit: dict[str, Any]) -> dict[str, tuple[float, float]]:
    """The unit's own nodes as offsets from their bounding-box top-left;
    nodes without saved coordinates fall into a row below the placed ones."""
    placed = {n["name"]: (float(n["x"]), float(n["y"])) for n in unit["nodes"] if "x" in n and "y" in n}
    if placed:
        min_x = min(x for x, _ in placed.values())
        min_y = min(y for _, y in placed.values())
        out = {name: (x - min_x, y - min_y) for name, (x, y) in placed.items()}
        floor = max(y for _, y in out.values()) + _SPACING
    else:
        out = {}
        floor = 0.0
    for j, n in enumerate(n for n in unit["nodes"] if n["name"] not in out):
        out[n["name"]] = (j * _SPACING, floor)
    return out


def _footprint(units: dict[str, dict[str, Any]], name: str, _stack: tuple[str, ...] = ()) -> tuple[float, float]:
    """(width, height) one instance of ``name`` occupies, children included."""
    unit = units.get(name)
    if unit is None or name in _stack:
        return (0.0, 0.0)
    own = _own_layout(unit)
    width = max((x for x, _ in own.values()), default=-_SPACING) + _SPACING
    height = max((y for _, y in own.values()), default=-_SPACING) + _SPACING
    child_w, child_h = 0.0, 0.0
    for ref in unit.get("includes", []):
        w, h = _footprint(units, ref["template"], (*_stack, name))
        child_w += (w + _SPACING) * ref.get("count", 1)
        child_h = max(child_h, h)
    return (max(width, child_w), height + (child_h + _SPACING if child_h else 0.0))


def _place_instance(
    units: dict[str, dict[str, Any]],
    name: str,
    inst: str,
    ox: float,
    oy: float,
    out: dict[str, Any],
    _stack: tuple[str, ...] = (),
) -> None:
    unit = units.get(name)
    if unit is None or name in _stack:
        return
    own = _own_layout(unit)

    # Carry the unit's canvas formatting onto this instance: position, icon,
    # and group membership follow the prefixed node names; group boxes get a
    # prefixed id and are translated by the same offset as the nodes they
    # contain.
    icons = unit.get("icons") or {}
    group_of = {
        entry.get("id"): entry.get("groupId")
        for entry in (unit.get("nodeAnnotations") or [])
        if entry.get("id") in own and entry.get("groupId")
    }
    used_groups: set[str] = set()
    for node_name, (dx, dy) in own.items():
        entry: dict[str, Any] = {"id": f"{inst}_{node_name}", "position": {"x": ox + dx, "y": oy + dy}}
        if node_name in icons:
            entry["icon"] = icons[node_name]
        group_id = group_of.get(node_name)
        if group_id:
            entry["groupId"] = f"{inst}_{group_id}"
            used_groups.add(group_id)
        out["nodeAnnotations"].append(entry)

    if used_groups:
        placed = [(float(n["x"]), float(n["y"])) for n in unit["nodes"] if "x" in n and "y" in n]
        min_x = min((x for x, _ in placed), default=0.0)
        min_y = min((y for _, y in placed), default=0.0)
        for style in unit.get("groupStyleAnnotations") or []:
            if style.get("id") not in used_groups:
                continue
            clone = dict(style)
            clone["id"] = f"{inst}_{style['id']}"
            pos = style.get("position")
            if isinstance(pos, dict) and "x" in pos and "y" in pos:
                clone["position"] = {"x": ox + float(pos["x"]) - min_x, "y": oy + float(pos["y"]) - min_y}
            out["groupStyleAnnotations"].append(clone)

    child_y = oy + (max((y for _, y in own.values()), default=-_SPACING) + 2 * _SPACING)
    child_x = ox
    for ref in unit.get("includes", []):
        ref_count = ref.get("count", 1)
        for j in range(1, ref_count + 1):
            child_inst = f"{inst}_{ref['template']}" if ref_count == 1 else f"{inst}_{ref['template']}{j}"
            _place_instance(units, ref["template"], child_inst, child_x, child_y, out, (*_stack, name))
            w, _ = _footprint(units, ref["template"], (*_stack, name))
            child_x += w + _SPACING
