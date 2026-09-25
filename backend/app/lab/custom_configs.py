"""Custom configuration templates for ``config: [name]`` — list and create.

See :mod:`services.netlab.custom_configs`.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.lab import common
from services.netlab import custom_configs

router = APIRouter()


class CustomConfig(BaseModel):
    name: str
    source: str
    path: str
    variants: list[str]
    editable: bool


class CustomConfigs(BaseModel):
    templates: list[CustomConfig]
    devices: list[str]
    defaultDevice: str = ""


class CustomConfigCreate(BaseModel):
    sessionId: str
    name: str
    device: str = ""


class CustomConfigCreated(BaseModel):
    path: str


def _lab_devices(path: str) -> list[str]:
    topo = commands.load_topology(path)
    default = topo.default("device")
    devices = {str(node.device or default) for node in topo.nodes if node.device or default}
    return sorted(devices)


@router.get("/custom-configs", response_model=CustomConfigs)
def list_custom_configs(sessionId: str):
    """Templates a node's ``config:`` can name, and the lab's devices."""
    path = common.session_path(sessionId)
    default = str(commands.load_topology(path).default("device") or "")
    return {
        "templates": custom_configs.discover(Path(path).parent),
        "devices": _lab_devices(path),
        "defaultDevice": default,
    }


@router.post("/custom-configs", response_model=CustomConfigCreated)
def create_custom_config(body: CustomConfigCreate):
    """Create ``<lab>/<name>/<device>.j2`` (kept when it exists); ``device``
    defaults to the lab's default device."""
    path = common.session_path(body.sessionId)
    device = body.device or str(commands.load_topology(path).default("device") or "")
    try:
        target = custom_configs.create(Path(path).parent, body.name.strip(), device.strip())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"path": str(target)}
