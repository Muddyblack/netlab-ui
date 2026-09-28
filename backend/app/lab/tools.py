"""netlab external tools for a lab (list, turn on/off, start/stop now) and
the lab's containerlab tarball export.

See :mod:`services.netlab.tools` for how this maps onto netlab's ``tools:``.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.contract import commands
from app.lab import common
from app.sessions.store import store
from services.netlab import setup, tools

router = APIRouter()

_TOOL_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class LabTool(BaseModel):
    id: str
    title: str
    description: str = ""
    runtime: str = ""
    docsUrl: str = ""
    enabled: bool = False
    deployed: bool = False
    running: bool = False
    canConnect: bool = False
    message: str = ""
    urls: list[str] = []


class LabTools(BaseModel):
    deployed: bool
    tools: list[LabTool]


class ToolToggle(BaseModel):
    sessionId: str
    tool: str
    enabled: bool


class ToolAction(BaseModel):
    sessionId: str
    tool: str
    action: Literal["up", "down"]


class ToolActionResult(BaseModel):
    code: int
    stdout: str
    stderr: str


def _tool_name(tool: str) -> str:
    if not _TOOL_RE.fullmatch(tool):
        raise HTTPException(400, "invalid tool name")
    return tool


async def _payload(path: str) -> LabTools:
    topo = commands.load_topology(path)
    lab_dir = Path(path).parent
    items = await tools.lab_tools(lab_dir, topo.attrs)
    return LabTools(deployed=tools.is_deployed(lab_dir), tools=[LabTool(**item) for item in items])


@router.get("/tools", response_model=LabTools)
async def get_tools(sessionId: str):
    return await _payload(common.session_path(sessionId))


@router.put("/tools", response_model=LabTools)
async def toggle_tool(body: ToolToggle):
    """Add the tool to the lab's ``tools:`` or remove it. Takes effect when the
    lab is next deployed."""
    tool = _tool_name(body.tool)
    session = store.get(body.sessionId)
    if session is None:
        raise HTTPException(404, "unknown session")
    topo = commands.load_topology(session.topology_path)
    tools.set_enabled(topo.attrs, tool, body.enabled)
    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return await _payload(session.topology_path)


@router.post("/tools/action", response_model=ToolActionResult)
async def tool_action(body: ToolAction):
    """Start or stop one tool of the deployed lab, as ``netlab up``/``down`` do."""
    path = common.session_path(body.sessionId)
    result = await tools.action(Path(path).parent, _tool_name(body.tool), body.action)
    return {"code": result.code, "stdout": result.stdout, "stderr": result.stderr}


@router.get("/clab-tarball", response_class=FileResponse)
async def clab_tarball(sessionId: str):
    """The deployed lab as a containerlab-only ``.tar.gz`` (``netlab clab
    tarball``): clab.yml plus the devices' current configs, to run with plain
    containerlab elsewhere."""
    path = common.session_path(sessionId)
    if not tools.is_deployed(Path(path).parent):
        raise HTTPException(409, "Deploy the lab first — the tarball carries the devices' running configs.")
    target, result = await setup.clab_tarball(path)
    if result.code or not target.is_file():
        shutil.rmtree(target.parent, ignore_errors=True)
        detail = (result.stderr or result.stdout).strip()[:1500] or "netlab clab tarball failed"
        raise HTTPException(409, detail)
    return FileResponse(
        target,
        media_type="application/gzip",
        filename=target.name,
        background=BackgroundTask(shutil.rmtree, target.parent, ignore_errors=True),
    )
