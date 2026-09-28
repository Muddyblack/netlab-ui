"""Running-config snapshots, drift and diffs (services/netlab/config_snapshots.py)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.lab import common
from services.netlab import config_snapshots as snapshots
from services.netlab import runner

router = APIRouter()

LIVE = "live"


class ConfigSnapshot(BaseModel):
    id: str
    createdAt: str
    reason: str = ""
    nodes: list[str] = []
    skipped: list[str] = []


class ConfigSnapshotList(BaseModel):
    snapshots: list[ConfigSnapshot]


class ConfigSnapshotRequest(BaseModel):
    sessionId: str
    reason: str = Field(default="manual snapshot", max_length=200)


class ConfigDriftRow(BaseModel):
    node: str
    status: str  # same | changed | not-in-snapshot | unavailable
    added: int = 0
    removed: int = 0


class ConfigDrift(BaseModel):
    snapshot: str
    nodes: list[ConfigDriftRow]


class ConfigSide(BaseModel):
    label: str
    text: str | None = None


class RunningConfigDiff(BaseModel):
    node: str
    left: ConfigSide
    right: ConfigSide


async def _require_netlab():
    if not runner.is_installed():
        raise HTTPException(503, "netlab is not installed")


@router.get("/configs/snapshots", response_model=ConfigSnapshotList)
def list_config_snapshots(sessionId: str):
    return {"snapshots": snapshots.list_snapshots(common.session_path(sessionId))}


@router.post("/configs/snapshots", response_model=ConfigSnapshot)
async def take_config_snapshot(body: ConfigSnapshotRequest):
    await _require_netlab()
    path = common.session_path(body.sessionId)
    try:
        return await snapshots.take_snapshot(path, body.reason)
    except runner.NetlabError as exc:
        raise HTTPException(409, f"lab status unavailable: {exc}") from exc


@router.get("/configs/drift", response_model=ConfigDrift)
async def config_drift(sessionId: str, snapshot: str | None = None):
    """How each running node's live configuration differs from a snapshot
    (the newest one when none is given)."""
    await _require_netlab()
    path = common.session_path(sessionId)
    snapshot_id = snapshot or next((str(s["id"]) for s in snapshots.list_snapshots(path)), None)
    if not snapshot_id:
        raise HTTPException(404, "no configuration snapshot yet — take one first")
    try:
        return {"snapshot": snapshot_id, "nodes": await snapshots.drift(path, snapshot_id)}
    except runner.NetlabError as exc:
        raise HTTPException(409, f"lab status unavailable: {exc}") from exc


async def _side(path: str, node: str, source: str) -> ConfigSide:
    if source == LIVE:
        config = (await snapshots.fetch_running(path, [node])).get(node)
        return ConfigSide(label="live now", text=snapshots.normalize(config) if config is not None else None)
    config = snapshots.read_snapshot(path, source, node)
    return ConfigSide(label=f"snapshot {source}", text=snapshots.normalize(config) if config is not None else None)


@router.get("/configs/diff", response_model=RunningConfigDiff)
async def running_config_diff(sessionId: str, node: str, left: str, right: str = LIVE):
    """One node's configuration from two sources — a snapshot id or ``live``."""
    await _require_netlab()
    path = common.session_path(sessionId)
    return {"node": node, "left": await _side(path, node, left), "right": await _side(path, node, right)}
