"""Unit (template) library endpoints: instantiate, CRUD, import/export,
placed-instance provenance."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.contract.responses import (
    InstantiateResult,
    TemplatesResult,
    UnitExportBundle,
    UnitImportRequest,
    UnitImportResult,
    UnitInstancesResult,
)
from app.contract.router._shared import router, session_or_404
from services import annotations as ann_store
from services import units
from services.model import serialize, templates


class InstantiateRequest(BaseModel):
    sessionId: str
    template: str
    count: int = 1
    prefix: str | None = None
    external_mappings: dict[str, str] | None = None
    # Optional canvas placement for the freshly-created nodes, written in the
    # *same* transaction so instantiate is atomic (no orphaned-node / lost-layout
    # window from a separate savePositions round-trip).
    positions: list[dict] | None = None
    # Alternative to ``positions``: a canvas drop point. The backend lays the
    # new nodes out in a compact grid around it (the client can't precompute
    # node names — expansion naming lives server-side).
    origin: dict | None = None
    # Optional per-placement parameterization ("room of N, device=X, image=Y"):
    # {"device": str, "image": str} standardizes every placed node.
    overrides: dict[str, Any] | None = None


@router.post("/templates/instantiate", response_model=InstantiateResult)
def instantiate_template(body: InstantiateRequest):
    """Expand a unit N times into the topology (the "duplicate a room x10"
    authoring macro). Unit definitions come from the workspace unit library.

    Nodes *and* their canvas positions are written in one undoable step."""
    session = session_or_404(body.sessionId)
    # Sidecars can gain legacy templates while a session is open (older tools
    # write them live), so the migration stays per-endpoint, not per-session.
    migrate_sidecar_templates(session)
    topo = commands.load_topology(session.topology_path)
    units_dir = units.units_dir_for(session.topology_path)
    topo.templates = units.load_templates(units_dir)

    try:
        with session.host.transaction():
            templates.instantiate(
                topo, body.template, body.count, body.prefix, body.external_mappings, overrides=body.overrides
            )
            commands.save_topology(session.topology_path, topo)
            for entry in body.positions or []:
                node_id = entry.get("id")
                pos = entry.get("position") or {}
                if node_id:
                    ann_store.set_position(session.topology_path, node_id, pos.get("x", 0), pos.get("y", 0))
            if body.origin is not None and not body.positions:
                # Re-create each unit's saved layout around the drop point,
                # plus the unit's canvas formatting (group boxes/colors, icons)
                # re-keyed to the instance names.
                unit_map = {u["name"]: u for u in units.list_units(units_dir)}
                extras = units.instance_annotations(
                    unit_map, body.template, body.count, body.prefix or body.template, body.origin
                )
                ann = ann_store.load(session.topology_path)
                new_node_anns = {e["id"] for e in extras["nodeAnnotations"]}
                ann["nodeAnnotations"] = [
                    e for e in ann.get("nodeAnnotations", []) if e.get("id") not in new_node_anns
                ] + extras["nodeAnnotations"]
                new_styles = {e["id"] for e in extras["groupStyleAnnotations"]}
                ann["groupStyleAnnotations"] = [
                    e for e in ann.get("groupStyleAnnotations", []) if e.get("id") not in new_styles
                ] + extras["groupStyleAnnotations"]
                ann_store.save(session.topology_path, ann)
            units.record_use(units_dir, body.template)
            # Stamp provenance so the dock can flag instances when the unit is
            # later edited. Names mirror templates.instantiate: bare prefix for
            # count 1, else <prefix>1..<prefix>N.
            base = body.prefix or body.template
            instance_names = [base] if body.count == 1 else [f"{base}{i}" for i in range(1, body.count + 1)]
            units.record_provenance(
                session.topology_path, instance_names, body.template, units.unit_version(units_dir, body.template)
            )
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "revision": session.revision, "yaml": serialize.to_yaml(topo)}


def migrate_sidecar_templates(session) -> None:
    """One-way migration: templates that used to live in a lab's own sidecar
    become workspace unit files (skipping names that already exist there)."""
    ann = ann_store.load(session.topology_path)
    legacy = ann.get("templates", [])
    if not legacy:
        return
    units_dir = units.units_dir_for(session.topology_path)
    existing = {u["name"] for u in units.list_units(units_dir)}
    for t in legacy:
        if t.get("name") and t["name"] not in existing:
            try:
                units.save_unit(units_dir, t)
            except ValueError:
                continue  # an invalid legacy template must not block the panel
    ann["templates"] = []
    ann_store.save(session.topology_path, ann)


@router.get("/templates", response_model=TemplatesResult)
def get_templates(sessionId: str):
    session = session_or_404(sessionId)
    migrate_sidecar_templates(session)
    return {"templates": units.list_units(units.units_dir_for(session.topology_path))}


@router.post("/templates", response_model=TemplatesResult)
def save_template(sessionId: str, body: dict):
    session = session_or_404(sessionId)
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    units_dir = units.units_dir_for(session.topology_path)
    try:
        units.save_unit(units_dir, body, source_topology=session.topology_path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"templates": units.list_units(units_dir)}


class CompositionRequest(BaseModel):
    sessionId: str
    # Everything the Composer owns; the canvas keeps ownership of nodes, internal
    # links, and layout. Omitted lists clear that facet of the composition.
    includes: list[dict[str, Any]] = []
    module: list[str] = []
    ports: list[str] = []
    links: list[dict[str, Any]] = []


@router.put("/templates/{name}/composition", response_model=TemplatesResult)
def update_template_composition(name: str, body: CompositionRequest):
    """Update only a unit's composition (includes / modules / ports / scaling
    connections) — the Composer rail's writer. Nodes, internal links and layout
    the canvas owns are left untouched."""
    session = session_or_404(body.sessionId)
    units_dir = units.units_dir_for(session.topology_path)
    try:
        units.update_unit_composition(
            units_dir,
            name,
            {"includes": body.includes, "module": body.module, "ports": body.ports, "links": body.links},
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"templates": units.list_units(units_dir)}


@router.delete("/templates/{name}", response_model=TemplatesResult)
def delete_template(sessionId: str, name: str):
    session = session_or_404(sessionId)
    units_dir = units.units_dir_for(session.topology_path)
    try:
        units.delete_unit(units_dir, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"templates": units.list_units(units_dir)}


@router.post("/templates/import", response_model=UnitImportResult)
def import_template(body: UnitImportRequest):
    session = session_or_404(body.sessionId)
    units_dir = units.units_dir_for(session.topology_path)
    try:
        name = units.import_unit(units_dir, body.bundle, overwrite=body.overwrite)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"name": name, "templates": units.list_units(units_dir)}


@router.get("/templates/instances", response_model=UnitInstancesResult)
def template_instances(sessionId: str):
    """Placed unit instances + whether each is behind its unit's current
    version (drives the 'update available' badge in the Units dock)."""
    session = session_or_404(sessionId)
    units_dir = units.units_dir_for(session.topology_path)
    topo = commands.load_topology(session.topology_path)
    existing_groups = {g.name for g in topo.groups}
    return {"instances": units.instance_provenance(session.topology_path, units_dir, existing_groups)}


@router.get("/templates/{name}/export", response_model=UnitExportBundle)
def export_template(sessionId: str, name: str):
    session = session_or_404(sessionId)
    units_dir = units.units_dir_for(session.topology_path)
    try:
        return units.export_unit(units_dir, name)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
