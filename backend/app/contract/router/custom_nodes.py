"""Custom node kind catalog endpoints (workspace-sidecar backed)."""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel

from app.contract.responses import CustomNodesResult
from app.contract.router._shared import router, session_or_404
from services import annotations as ann_store


class DefaultNodeRequest(BaseModel):
    defaultNode: str


@router.get("/custom-nodes", response_model=CustomNodesResult)
def get_custom_nodes(sessionId: str):
    session = session_or_404(sessionId)
    ann = ann_store.load(session.topology_path)
    return {"customNodes": ann.get("customNodes", []), "defaultNode": ann.get("defaultNode", "")}


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
