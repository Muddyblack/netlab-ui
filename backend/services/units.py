"""Workspace-level unit library.

A *unit* is a reusable topology fragment ("a workstation", "a room of 4
workstations") stored as a real netlab YAML file in ``<workspace>/units/`` so
it can be opened and edited on the canvas exactly like a lab. What has no
place in netlab YAML lives in the unit's own annotation files (see
``services.annotations.store``):

  - node positions and icon overrides live inside clab-ui's own
    ``nodeAnnotations`` entries (``{id, groupId, position, icon}``) — the canvas
    already reads/writes it, so a unit opened as a lab keeps its layout;
  - group box styling uses clab-ui's own ``groupStyleAnnotations`` key,
    so a unit opened as a lab shows its colored groups, and instantiate can
    stamp them onto every placed copy;
  - composition (``includes``), shared ``module`` list, and links to nodes
    *outside* the unit sit under a netlab-gui-only ``unit`` key.

Units being per-workspace (not per-lab) is the point: define a workstation
once, drop it into any lab in the workspace.
"""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ruamel.yaml import YAMLError

from services import annotations as ann_store
from services import workspaces as ws_store
from services.model import serialize
from services.model.topology import IncludeRef, Link, Node, Template, Topology
from services.units_layout import instance_annotations, instance_layout  # noqa: F401

_UNITS_DIR_NAME = "units"
_UNIT_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")

# clab-ui keeps canvas annotations in the React Flow node array. These fields
# describe rendering/session state and can never be netlab node attributes.
_VIEW_STATE_ATTRS = {
    "id",
    "name",
    "type",
    "label",
    "state",
    "kind",
    "role",
    "topoViewerRole",
    "group",
    "groupId",
    "icon",
    "iconColor",
    "extraData",
    "level",
    "width",
    "height",
    "backgroundColor",
    "borderColor",
    "borderWidth",
    "borderStyle",
    "borderRadius",
    "zIndex",
}
_VISUAL_NODE_MARKERS = {
    "backgroundColor",
    "borderColor",
    "borderWidth",
    "borderStyle",
    "borderRadius",
    "zIndex",
}


def _declarative_node_bodies(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop annotation pseudo-nodes and strip canvas-only fields defensively."""
    out: list[dict[str, Any]] = []
    for node in nodes:
        if not node.get("name"):
            continue
        attrs = dict(node.get("attrs") or {})
        if not node.get("device") and _VISUAL_NODE_MARKERS.intersection(attrs):
            continue
        out.append(
            {
                **node,
                "attrs": {key: value for key, value in attrs.items() if key not in _VIEW_STATE_ATTRS},
            }
        )
    return out


def units_dir_for(topology_path: str | Path) -> Path:
    """The ``units/`` dir of the workspace containing ``topology_path``. A lab
    outside every configured workspace keeps its units next to itself."""
    p = Path(topology_path).resolve()
    for ws in (Path(w) for w in ws_store.load()):
        if p.is_relative_to(ws):
            return ws / _UNITS_DIR_NAME
    return p.parent / _UNITS_DIR_NAME


def _unit_path(units_dir: Path, name: str) -> Path:
    if not _UNIT_NAME_RE.fullmatch(name) or name in {".", ".."}:
        raise ValueError(f"invalid unit name: {name!r}")
    # Normalize through `realpath` (so a symlinked unit file can't point out of
    # the library) and containment-check the result. The normalize-then-
    # `startswith` pair is kept literal and local on purpose — see the note in
    # `app.lab.common`.
    root = os.path.normpath(os.path.realpath(str(units_dir)))
    path = os.path.normpath(os.path.realpath(os.path.join(root, f"{name}.yml")))
    if not path.startswith(root + os.sep):
        raise ValueError(f"invalid unit path: {name!r}")
    if os.path.dirname(path) != root:
        raise ValueError(f"invalid unit path: {name!r}")
    return Path(path)


def list_units(units_dir: Path) -> list[dict[str, Any]]:
    """All units in the workspace, in the wire shape the panel expects:
    ``{name, path, nodes(+x/y), links, includes, module}``."""
    if not units_dir.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(units_dir.glob("*.yml")) + sorted(units_dir.glob("*.yaml")):
        try:
            out.append(_load_unit(path))
        except (OSError, TypeError, ValueError, YAMLError):
            continue  # an unparseable file must not take the panel down
    return out


def _load_unit(path: Path) -> dict[str, Any]:
    topo = serialize.from_yaml(path.read_text())
    ann = ann_store.load(path)
    node_anns = ann.get("nodeAnnotations") or []
    icons_map = {n["id"]: n["icon"] for n in node_anns if isinstance(n, dict) and n.get("icon")}
    meta = ann.get("unit") or {}

    nodes = []
    for n in topo.nodes:
        # Older unit files may contain canvas-only fields written before the
        # unit serializer filtered them. Never let those stale visual values
        # flow back into an instantiated netlab topology.
        attrs = {key: value for key, value in n.attrs.items() if key not in _VIEW_STATE_ATTRS}
        entry: dict[str, Any] = {"name": n.name, "device": n.device, "attrs": attrs}
        pos = ann_store.get_node_annotation(ann, n.name)
        pos = pos.get("position") if pos else None
        if pos:
            entry["x"] = pos.get("x", 0)
            entry["y"] = pos.get("y", 0)
        nodes.append(entry)

    links = [{"endpoints": list(link.endpoints), "attrs": dict(link.attrs)} for link in topo.links]
    links += [dict(item) for item in (meta.get("externalLinks") or [])]

    return {
        "name": path.stem,
        "path": str(path),
        "usageCount": _usage_count(meta),
        "version": max(1, _unit_version_value(meta)),
        "nodes": nodes,
        "links": links,
        "includes": [dict(i) for i in (meta.get("includes") or []) if i.get("template")],
        "module": list(meta.get("module") or []),
        "ports": [str(p) for p in (meta.get("ports") or []) if str(p)],
        # Canvas view-state carried with the unit (standard sidecar keys).
        "nodeAnnotations": [dict(n) for n in node_anns],
        "groupStyleAnnotations": [dict(s) for s in (ann.get("groupStyleAnnotations") or [])],
        "icons": icons_map,
    }


def _usage_count(meta: dict[str, Any]) -> int:
    """Read the optional placement counter without letting malformed UI
    metadata prevent a unit from loading."""
    try:
        return max(0, int(meta.get("usageCount", 0)))
    except (TypeError, ValueError):
        return 0


def record_use(units_dir: Path, name: str) -> None:
    """Increment a unit's workspace-local placement count."""
    path = _unit_path(units_dir, name)
    ann = ann_store.load(path)
    meta = ann.get("unit") or {}
    meta["usageCount"] = _usage_count(meta) + 1
    ann["unit"] = meta
    ann_store.save(path, ann)


def _clean_ports(raw: Any, node_names: set[str]) -> list[str]:
    """Keep only real, own-node names, de-duplicated in given order. Ports are a
    UI hint (which nodes a parent may wire to); they never invent nodes."""
    out: list[str] = []
    for p in raw or []:
        name = str(p)
        if name in node_names and name not in out:
            out.append(name)
    return out


def save_unit(units_dir: Path, body: dict[str, Any], source_topology: str | Path | None = None) -> Path:
    """Persist a unit from the panel's create/update payload. The YAML gets
    the nodes and *internal* links; everything else goes to the sidecar.

    ``source_topology`` is the lab the unit is being carved out of: its sidecar
    supplies the canvas group membership/styling and icon overrides for the
    unit's nodes, so "save selection as unit" keeps the visual formatting."""
    name = str(body.get("name") or "").strip()
    path = _unit_path(units_dir, name)

    node_bodies = _declarative_node_bodies(list(body.get("nodes") or []))
    node_names = {n["name"] for n in node_bodies}

    includes = [
        {"template": i["template"], "count": max(1, int(i.get("count", 1)))}
        for i in (body.get("includes") or [])
        if i.get("template")
    ]
    all_links = [
        {"endpoints": list(link.get("endpoints") or []), "attrs": dict(link.get("attrs") or {})}
        for link in (body.get("links") or [])
    ]
    _validate_dotted_endpoints(units_dir, node_names, includes, all_links)

    units_dir.mkdir(parents=True, exist_ok=True)
    topo = Topology(name=name)
    for n in node_bodies:
        topo.nodes.append(Node(name=n["name"], device=n.get("device"), attrs=dict(n.get("attrs") or {})))

    internal, external = [], []
    for item in all_links:
        endpoints = item["endpoints"]
        target = internal if endpoints and all(e in node_names for e in endpoints) else external
        target.append(item)
    topo.links = [Link(endpoints=item["endpoints"], attrs=item["attrs"]) for item in internal]

    path.write_text(serialize.to_yaml(topo))

    ann = ann_store.load(path)
    if source_topology is not None and node_bodies:
        _capture_view_state(ann, source_topology, [n["name"] for n in node_bodies])
    for n in node_bodies:
        if "x" in n and "y" in n:
            ann_store.ensure_node_annotation(ann, n["name"])["position"] = {"x": n["x"], "y": n["y"]}
    existing_meta = ann.get("unit") or {}
    ann["unit"] = {
        "includes": includes,
        "module": [m for m in (body.get("module") or []) if str(m).strip()],
        # Own nodes this unit exposes as connection points to a parent ("the
        # workplace's uplink"). Only real, own nodes qualify.
        "ports": _clean_ports(body.get("ports", existing_meta.get("ports")), node_names),
        "externalLinks": external,
        # Editing a unit must not erase its usage-based dock ordering.
        "usageCount": _usage_count(existing_meta),
        # Bumped on every save so placed instances can detect they're stale. A
        # brand-new unit starts at v1.
        "version": _unit_version_value(existing_meta) + 1,
    }
    ann_store.save(path, ann)
    return path


def _is_child_wiring(link: dict[str, Any]) -> bool:
    """A connection into an included instance — has a dotted endpoint
    (``wp.uplink``). These are what the Composer owns; plain external carve-out
    links (no dot) are left alone."""
    return any(isinstance(e, str) and "." in e for e in (link.get("endpoints") or []))


def update_unit_composition(units_dir: Path, name: str, body: dict[str, Any]) -> Path:
    """Update only a unit's *composition* — includes, shared modules, exposed
    ports, and the connections into included instances — without touching the
    nodes, internal links, or layout the canvas owns.

    This is the second writer of a unit file (the canvas is the first). It edits
    just the sidecar ``unit`` block, so a unit can be drawn on the canvas and
    composed in the Composer rail at the same time without either clobbering the
    other. Bumps the version so placed instances can detect they are stale."""
    path = _unit_path(units_dir, name)
    if not path.exists():
        raise ValueError(f"unknown unit: {name}")

    topo = serialize.from_yaml(path.read_text())
    node_names = {n.name for n in topo.nodes}

    includes = [
        {"template": i["template"], "count": max(1, int(i.get("count", 1)))}
        for i in (body.get("includes") or [])
        if i.get("template")
    ]
    connections = [
        {"endpoints": list(link.get("endpoints") or []), "attrs": dict(link.get("attrs") or {})}
        for link in (body.get("links") or [])
        if link.get("endpoints")
    ]
    _validate_dotted_endpoints(units_dir, node_names, includes, connections)

    ann = ann_store.load(path)
    existing_meta = ann.get("unit") or {}
    # Preserve external carve-out links (no dotted endpoint); replace the
    # child-wiring connections the Composer manages.
    kept_external = [link for link in (existing_meta.get("externalLinks") or []) if not _is_child_wiring(link)]
    ann["unit"] = {
        **existing_meta,
        "includes": includes,
        "module": [m for m in (body.get("module") or []) if str(m).strip()],
        "ports": _clean_ports(body.get("ports"), node_names),
        "externalLinks": kept_external + connections,
        "usageCount": _usage_count(existing_meta),
        "version": _unit_version_value(existing_meta) + 1,
    }
    ann_store.save(path, ann)
    return path


def _unit_version_value(meta: dict[str, Any]) -> int:
    try:
        return max(0, int(meta.get("version", 0)))
    except (TypeError, ValueError):
        return 0


def unit_version(units_dir: Path, name: str) -> int:
    """Current version of a unit, or 0 if it does not exist."""
    path = _unit_path(units_dir, name)
    if not path.exists():
        return 0
    return _unit_version_value(ann_store.load(path).get("unit") or {})


def record_provenance(topology_path: str | Path, instances: list[str], unit: str, version: int) -> None:
    """Stamp each freshly-placed instance group with the unit + version it came
    from, in the *lab's* sidecar (never in netlab YAML)."""
    ann = ann_store.load(topology_path)
    prov = ann.get("unitInstances")
    prov = prov if isinstance(prov, dict) else {}
    stamped_at = datetime.now(UTC).isoformat()
    for inst in instances:
        prov[inst] = {"unit": unit, "version": version, "placedAt": stamped_at}
    ann["unitInstances"] = prov
    ann_store.save(topology_path, ann)


def instance_provenance(topology_path: str | Path, units_dir: Path, existing_groups: set[str]) -> list[dict[str, Any]]:
    """Report every recorded instance and whether it is behind the unit's
    current version (or orphaned because the unit was deleted)."""
    prov = ann_store.load(topology_path).get("unitInstances")
    prov = prov if isinstance(prov, dict) else {}
    versions = {u["name"]: _unit_version_value({"version": u.get("version", 1)}) for u in list_units(units_dir)}
    rows: list[dict[str, Any]] = []
    for inst, meta in prov.items():
        if not isinstance(meta, dict):
            continue
        unit = str(meta.get("unit") or "")
        placed = _unit_version_value(meta)
        current = versions.get(unit)
        rows.append(
            {
                "instance": str(inst),
                "unit": unit,
                "version": placed,
                "currentVersion": current,
                "exists": str(inst) in existing_groups,
                "outdated": current is not None and placed < current,
                "orphaned": current is None,
            }
        )
    return rows


def _capture_view_state(ann: dict[str, Any], source_topology: str | Path, node_names: list[str]) -> None:
    """Copy the source lab's canvas formatting for the unit's nodes into the
    unit sidecar: group membership, the styling of those groups (color, border,
    box geometry), and icon overrides."""
    src = ann_store.load(source_topology)
    src_by_id = {n.get("id"): n for n in (src.get("nodeAnnotations") or []) if isinstance(n, dict) and n.get("id")}
    group_of = {nid: e["groupId"] for nid, e in src_by_id.items() if e.get("groupId")}
    ann["nodeAnnotations"] = [{"id": n, "groupId": group_of[n]} for n in node_names if n in group_of]
    used = {e["groupId"] for e in ann["nodeAnnotations"]}
    ann["groupStyleAnnotations"] = [
        dict(s) for s in (src.get("groupStyleAnnotations") or []) if isinstance(s, dict) and s.get("id") in used
    ]
    for n in node_names:
        icon = src_by_id.get(n, {}).get("icon")
        if icon:
            ann_store.ensure_node_annotation(ann, n)["icon"] = icon


_MAX_DOTTED_DEPTH = 10


def _validate_dotted_endpoints(
    units_dir: Path, node_names: set[str], includes: list[dict[str, Any]], links: list[dict[str, Any]]
) -> None:
    """Check every dotted link endpoint (``room2.sw``) against the include list:
    the first segment must name an actual include instance, intermediate
    segments must keep resolving through nested includes, and the final segment
    must be a node the referenced unit itself defines — exactly the naming
    template expansion will produce. Raises ``ValueError`` with a message that
    says which part is wrong."""
    dotted = [e for link in links for e in link.get("endpoints") or [] if isinstance(e, str) and "." in e]
    if not dotted:
        return
    library = {u["name"]: u for u in list_units(units_dir)}

    def instance_map(inc_list: list[dict[str, Any]]) -> dict[str, str]:
        out: dict[str, str] = {}
        for i in inc_list:
            template = i.get("template")
            if not template:
                continue
            count = max(1, int(i.get("count", 1) or 1))
            # The bare template name is always valid: for count 1 it *is* the
            # instance; for count>1 it means "every instance" — a fan-out rule
            # (``wp.uplink`` → one link per workplace) that scales with the count.
            out[template] = template
            if count > 1:
                for j in range(1, count + 1):
                    out[f"{template}{j}"] = template
        return out

    def check(endpoint: str, rest: str, inc_list: list[dict[str, Any]], depth: int) -> None:
        if depth > _MAX_DOTTED_DEPTH:
            raise ValueError(f"link endpoint {endpoint!r}: nesting too deep")
        seg, remainder = rest.split(".", 1)
        instances = instance_map(inc_list)
        template = instances.get(seg)
        if template is None:
            known = ", ".join(sorted(instances)) or "none"
            raise ValueError(
                f"link endpoint {endpoint!r}: {seg!r} does not name an included instance (available: {known})"
            )
        child = library.get(template)
        if child is None:
            raise ValueError(f"link endpoint {endpoint!r}: included unit {template!r} does not exist")
        if "." in remainder:
            check(endpoint, remainder, child.get("includes") or [], depth + 1)
        elif remainder not in {n["name"] for n in child.get("nodes") or []}:
            raise ValueError(f"link endpoint {endpoint!r}: unit {template!r} has no node {remainder!r}")

    for endpoint in dotted:
        if endpoint in node_names:
            continue  # a literal node name that happens to contain a dot
        check(endpoint, endpoint, includes, 1)


def delete_unit(units_dir: Path, name: str) -> None:
    path = _unit_path(units_dir, name)
    path.unlink(missing_ok=True)
    ann_store.clab_annotations_path(path).unlink(missing_ok=True)
    ann_store.sidecar_path(path).unlink(missing_ok=True)


_BUNDLE_KIND = "netlab-unit"


def export_unit(units_dir: Path, name: str) -> dict[str, Any]:
    """A portable, self-contained bundle for one unit (topology + view-state),
    shareable across workspaces/people."""
    path = _unit_path(units_dir, name)
    if not path.exists():
        raise ValueError(f"unknown unit: {name}")
    return {"schemaVersion": 1, "kind": _BUNDLE_KIND, "unit": _load_unit(path)}


def _unique_name(units_dir: Path, name: str) -> str:
    existing = {u["name"] for u in list_units(units_dir)}
    if name not in existing:
        return name
    index = 2
    while f"{name}-{index}" in existing:
        index += 1
    return f"{name}-{index}"


def import_unit(units_dir: Path, bundle: dict[str, Any], *, overwrite: bool = False) -> str:
    """Write a unit from an :func:`export_unit` bundle into this workspace.

    Names collide across workspaces, so by default an incoming unit is renamed
    (``room`` → ``room-2``) unless ``overwrite`` is set. Canvas view-state
    (group styling, icons, positions) is restored from the bundle."""
    if not isinstance(bundle, dict) or bundle.get("kind") != _BUNDLE_KIND:
        raise ValueError("not a netlab-unit bundle")
    unit = bundle.get("unit")
    if not isinstance(unit, dict) or not str(unit.get("name") or "").strip():
        raise ValueError("bundle has no unit definition")

    name = str(unit["name"]).strip()
    if not overwrite:
        name = _unique_name(units_dir, name)

    save_unit(
        units_dir,
        {
            "name": name,
            "nodes": unit.get("nodes") or [],
            "links": unit.get("links") or [],
            "includes": unit.get("includes") or [],
            "module": unit.get("module") or [],
            "ports": unit.get("ports") or [],
        },
    )

    # Restore canvas formatting the topology serializer does not carry. Node
    # names are internal to the unit and unchanged by any rename, so annotations
    # keyed by them stay valid.
    path = _unit_path(units_dir, name)
    ann = ann_store.load(path)
    if unit.get("nodeAnnotations"):
        ann["nodeAnnotations"] = [dict(item) for item in unit["nodeAnnotations"]]
    if unit.get("groupStyleAnnotations"):
        ann["groupStyleAnnotations"] = [dict(item) for item in unit["groupStyleAnnotations"]]
    if unit.get("icons"):
        for node_name, icon in dict(unit["icons"]).items():
            ann_store.ensure_node_annotation(ann, node_name)["icon"] = icon
    ann_store.save(path, ann)
    return name


def load_templates(units_dir: Path) -> list[Template]:
    """Hydrate expansion-ready :class:`Template` objects from the unit files."""
    return [_to_template(u) for u in list_units(units_dir)]


def _to_template(unit: dict[str, Any]) -> Template:
    return Template(
        name=unit["name"],
        nodes=[Node(name=n["name"], device=n.get("device"), attrs=dict(n.get("attrs") or {})) for n in unit["nodes"]],
        links=[Link(endpoints=list(link["endpoints"]), attrs=dict(link.get("attrs") or {})) for link in unit["links"]],
        module=list(unit.get("module") or []),
        includes=[IncludeRef(template=i["template"], count=i.get("count", 1)) for i in unit.get("includes", [])],
    )
