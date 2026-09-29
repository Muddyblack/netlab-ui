"""Custom node kind catalog endpoints (workspace-sidecar backed)."""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.contract.responses import CustomNodesResult
from app.contract.router._shared import router, session_or_404
from services import annotations as ann_store


class DefaultNodeRequest(BaseModel):
    defaultNode: str


def _template_for_device(device: str) -> dict:
    is_host = device == "linux"
    return {"name": device, "kind": device, "baseName": "h" if is_host else "r", "icon": "client" if is_host else "pe"}


def _devices_in_use(topology_path: str) -> list[str]:
    """Devices the lab's nodes already use (their own, their group's, or the
    ``defaults`` one), in first-seen order — so an existing lab's palette
    starts with its own gear. Empty for a lab without nodes."""
    try:
        topo = commands.load_topology(topology_path)
    except Exception:  # noqa: BLE001 — unreadable YAML: fall back to the starters
        return []
    devices = [node.device for node in topo.nodes]
    if any(device is None for device in devices):
        devices.append(topo.default("device"))
    devices += [group.attrs.get("device") for group in topo.groups]
    return [*dict.fromkeys(d for d in devices if isinstance(d, str) and d)]


def _starter_templates(topology_path: str) -> list[dict]:
    """A router and a host for a lab with no nodes yet.

    clab-ui's canvas "Add Node" and Shift+click place the *default node
    template*; with no template at all they silently do nothing, which left a
    fresh netlab lab with no obvious way to place its first node."""
    try:
        default_device = commands.load_topology(topology_path).default("device")
    except Exception:  # noqa: BLE001
        default_device = None
    router_device = default_device if default_device and default_device != "linux" else "frr"
    return [
        {"name": "router", "kind": router_device, "baseName": "r", "icon": "pe"},
        {"name": "host", "kind": "linux", "baseName": "h", "icon": "client"},
    ]


def _catalog(topology_path: str, ann: dict) -> dict:
    """The lab's saved templates plus what is offered without being saved.

    A lab whose YAML already has nodes gets one template per device it uses
    (unless the user removed it, or a saved template already covers it). A lab
    without any gets the starters until its first own template replaces them."""
    saved = ann.get("customNodes") or []
    hidden = set(ann.get("hiddenTemplates") or [])
    taken = {t.get("name") for t in saved} | {t.get("kind") for t in saved}
    devices = _devices_in_use(topology_path)
    offered = [_template_for_device(d) for d in devices] if devices else ([] if saved else _starter_templates(topology_path))
    templates = [*saved, *(t for t in offered if t["name"] not in hidden and t["name"] not in taken)]
    default = ann.get("defaultNode", "")
    if not default and templates and not saved:
        default = templates[0]["name"]
    return {"customNodes": templates, "defaultNode": default}


@router.get("/custom-nodes", response_model=CustomNodesResult)
def get_custom_nodes(sessionId: str):
    session = session_or_404(sessionId)
    return _catalog(session.topology_path, ann_store.load(session.topology_path))


@router.post("/custom-nodes", response_model=CustomNodesResult)
def save_custom_node(sessionId: str, body: dict):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)

    name = body.get("name")
    if not name:
        raise HTTPException(400, "name is required")

    ann["customNodes"] = [*(t for t in ann.get("customNodes", []) if t.get("name") != name), body]
    ann["hiddenTemplates"] = [n for n in ann.get("hiddenTemplates", []) if n != name]
    ann_store.save(session.topology_path, ann)
    return _catalog(session.topology_path, ann)


class ImportTemplatesRequest(BaseModel):
    templates: list[dict]


@router.post("/custom-nodes/import", response_model=CustomNodesResult)
def import_custom_nodes(sessionId: str, body: ImportTemplatesRequest):
    """Merge templates from an exported file (same name replaces)."""
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)
    for template in body.templates:
        if not template.get("name") or not template.get("kind"):
            raise HTTPException(400, 'every template needs a "name" and a "kind"')
    incoming = {t["name"]: t for t in body.templates}
    kept = [t for t in ann.get("customNodes", []) if t.get("name") not in incoming]
    ann["customNodes"] = [*kept, *incoming.values()]
    ann["hiddenTemplates"] = [n for n in ann.get("hiddenTemplates", []) if n not in incoming]
    ann_store.save(session.topology_path, ann)
    return _catalog(session.topology_path, ann)


@router.delete("/custom-nodes/{name}", response_model=CustomNodesResult)
def delete_custom_node(sessionId: str, name: str):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)

    ann["customNodes"] = [t for t in ann.get("customNodes", []) if t.get("name") != name]
    # A starter (derived from the YAML's devices) is not stored anywhere, so
    # removing it means remembering not to offer it again.
    ann["hiddenTemplates"] = [*dict.fromkeys([*ann.get("hiddenTemplates", []), name])]
    if ann.get("defaultNode", "") == name:
        ann["defaultNode"] = ""

    ann_store.save(session.topology_path, ann)
    return _catalog(session.topology_path, ann)


@router.post("/custom-nodes/default", response_model=CustomNodesResult)
def set_default_custom_node(sessionId: str, body: DefaultNodeRequest):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)

    ann["defaultNode"] = body.defaultNode
    ann_store.save(session.topology_path, ann)
    return _catalog(session.topology_path, ann)
