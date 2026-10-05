"""Per-node generated config files (right-click a node → Config Files)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.lab import common
from services.netlab import node_configs

router = APIRouter()


class NodeConfigFile(BaseModel):
    name: str
    path: str
    group: str
    size: int


class NodeConfigFiles(BaseModel):
    node: str
    files: list[NodeConfigFile]


@router.get("/node-configs", response_model=NodeConfigFiles)
def list_node_configs(sessionId: str, node: str):
    """Files netlab generated for ``node``; empty until the lab has been created."""
    lab_dir = Path(common.session_path(sessionId)).parent
    try:
        files = node_configs.list_files(lab_dir, node)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"node": node, "files": files}
