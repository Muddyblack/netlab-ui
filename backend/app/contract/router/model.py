"""Authoring-panel model endpoints: raw YAML get/put + per-node config preview."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.contract.responses import ConfigPreviewResult, RevisionResult
from app.contract.router._shared import router, session_or_404
from services.model import serialize
from services.netlab import config_preview, runner


class ModelPut(BaseModel):
    sessionId: str
    yaml: str


@router.get("/model", response_model=dict[str, Any])
def get_model(sessionId: str):
    session = session_or_404(sessionId)
    topo = commands.load_topology(session.topology_path)
    return serialize.to_dict(topo)


@router.put("/model", response_model=RevisionResult)
def put_model(body: ModelPut):
    session = session_or_404(body.sessionId)
    try:
        topo = serialize.from_yaml(body.yaml)
    except Exception as exc:
        raise HTTPException(422, f"Invalid YAML: {exc}") from exc
    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return {"ok": True, "revision": session.revision}


@router.get("/nodes/{node_name}/config-preview", response_model=ConfigPreviewResult)
async def get_node_config_preview(sessionId: str, node_name: str):
    """Generate and return the exact config artifacts for one topology node."""
    if not config_preview.is_safe_node_name(node_name):
        raise HTTPException(400, "invalid node name")
    session = session_or_404(sessionId)
    topo = commands.load_topology(session.topology_path)
    if topo.node(node_name) is None:
        raise HTTPException(404, f"unknown node {node_name!r}")

    try:
        await runner.create(session.topology_path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(422, str(exc)) from exc

    files = config_preview.read_node_files(session.topology_path, node_name)
    return {
        "node": node_name,
        "files": files,
        "generated": True,
        "message": None if files else "netlab did not generate configuration files for this node",
    }
