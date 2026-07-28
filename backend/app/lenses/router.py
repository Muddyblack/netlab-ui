from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.contract.responses import (
    ConfigDiffResult,
    LensBundleResult,
    PathResult,
    ReadinessResult,
    ReportCatalogResult,
    ReportRunRequest,
    ReportRunResult,
    TeachingDocument,
    TeachingSaveRequest,
    TeachingSaveResult,
)
from app.sessions.store import store
from services.lenses import config_diff, path_explorer, readiness, reports, service, teaching
from services.netlab import config_preview, runner

router = APIRouter(prefix="/api/topology", tags=["lenses"])


@router.get("/lenses", response_model=LensBundleResult)
async def get_lenses(session_id: str = Query(alias="sessionId")):
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        return await service.bundle_for(session.topology_path, session.revision)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        detail = exc.stderr.strip() or str(exc)
        raise HTTPException(422, detail) from exc


@router.get("/path", response_model=PathResult)
async def get_path(
    session_id: str = Query(alias="sessionId"),
    source: str = Query(),
    target: str = Query(),
    family: str = Query(default="ipv4"),
    vrf: str = Query(default="default"),
):
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    if family not in ("ipv4", "ipv6"):
        raise HTTPException(400, "family must be ipv4 or ipv6")
    try:
        artifact = await runner.create(session.topology_path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(422, exc.stderr.strip() or str(exc)) from exc
    return path_explorer.compute_path(
        artifact["snapshot"],
        source=source,
        target=target,
        family=family,
        vrf=vrf,
        snapshot_key=artifact.get("source_hash"),
    )


@router.get("/readiness", response_model=ReadinessResult)
async def get_readiness(session_id: str = Query(alias="sessionId")):
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        return await readiness.build_readiness(session.topology_path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/config-diff", response_model=ConfigDiffResult)
async def get_config_diff(
    session_id: str = Query(alias="sessionId"),
    left: str = Query(),
    right: str = Query(),
):
    if not config_preview.is_safe_node_name(left) or not config_preview.is_safe_node_name(right):
        raise HTTPException(400, "invalid node name")
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    # Ensure config artifacts exist (create is hash-cached; -o config writes
    # node_files the diff reads).
    try:
        await runner.create(session.topology_path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(422, exc.stderr.strip() or str(exc)) from exc
    return config_diff.build_config_diff(session.topology_path, left, right)


@router.get("/reports", response_model=ReportCatalogResult)
async def get_reports(session_id: str = Query(alias="sessionId")):
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        return {"reports": await reports.catalog(session.topology_path)}
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(422, exc.stderr.strip() or str(exc)) from exc


@router.post("/reports/run", response_model=ReportRunResult)
async def run_report(body: ReportRunRequest):
    try:
        session = store.require(body.sessionId)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        return await reports.run(session.topology_path, session.revision, body.reportId)
    except KeyError as exc:
        raise HTTPException(404, f"unknown report: {body.reportId}") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except (runner.NetlabError, RuntimeError) as exc:
        detail = exc.stderr.strip() if isinstance(exc, runner.NetlabError) else str(exc)
        raise HTTPException(422, detail or str(exc)) from exc


@router.get("/teaching", response_model=TeachingDocument)
def get_teaching(session_id: str = Query(alias="sessionId")):
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    return teaching.load(session.topology_path)


@router.put("/teaching", response_model=TeachingSaveResult)
def put_teaching(body: TeachingSaveRequest):
    try:
        session = store.require(body.sessionId)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    document = teaching.save(session.topology_path, body.document.model_dump())
    return {"ok": True, "document": document}
