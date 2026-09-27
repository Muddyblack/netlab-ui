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


def _builtin_templates(topology_path: str) -> list[dict]:
    """Starter templates for a lab that has none of its own.

    clab-ui's canvas "Add Node" and Shift+click place the *default node
    template*; with no template at all they silently do nothing, which left a
    fresh netlab lab with no obvious way to place its first node. These are
    served, not saved: the first template the user creates replaces them.
    """
    try:
        default_device = commands.load_topology(topology_path).defaults.get("device")
    except Exception:  # noqa: BLE001 — unreadable YAML: still offer something
        default_device = None
    router_device = default_device if default_device and default_device != "linux" else "frr"
    return [
        {"name": "router", "kind": router_device, "baseName": "r", "icon": "pe"},
        {"name": "host", "kind": "linux", "baseName": "h", "icon": "client"},
    ]


@router.get("/custom-nodes", response_model=CustomNodesResult)
def get_custom_nodes(sessionId: str):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)
    saved = ann.get("customNodes") or []
    if not saved:
        return {"customNodes": _builtin_templates(session.topology_path), "defaultNode": "router"}
    return {"customNodes": saved, "defaultNode": ann.get("defaultNode", "")}


@router.post("/custom-nodes", response_model=CustomNodesResult)
def save_custom_node(sessionId: str, body: dict):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)

    custom_nodes = ann.get("customNodes", [])
    name = body.get("name")
    if not name:
        raise HTTPException(400, "name is required")

    custom_nodes = [t for t in custom_nodes if t.get("name") != name]
    custom_nodes.append(body)

    ann["customNodes"] = custom_nodes
    ann_store.save(session.topology_path, ann)
    return {"customNodes": custom_nodes, "defaultNode": ann.get("defaultNode", "")}


@router.delete("/custom-nodes/{name}", response_model=CustomNodesResult)
def delete_custom_node(sessionId: str, name: str):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)

    custom_nodes = ann.get("customNodes", [])
    custom_nodes = [t for t in custom_nodes if t.get("name") != name]
    ann["customNodes"] = custom_nodes

    default_node = ann.get("defaultNode", "")
    if default_node == name:
        default_node = ""
        ann["defaultNode"] = ""

    ann_store.save(session.topology_path, ann)
    return {"customNodes": custom_nodes, "defaultNode": default_node}


@router.post("/custom-nodes/default", response_model=CustomNodesResult)
def set_default_custom_node(sessionId: str, body: DefaultNodeRequest):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)

    ann["defaultNode"] = body.defaultNode
    ann_store.save(session.topology_path, ann)
    return {"customNodes": ann.get("customNodes", []), "defaultNode": body.defaultNode}
