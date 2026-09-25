from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.contract.responses import (
    ConfigDiffResult,
    LabSearchResult,
    LensBundleResult,
    PathResult,
    ReadinessResult,
    ReportCatalogResult,
    ReportRunRequest,
    ReportRunResult,
    TeachingCheckRequest,
    TeachingCheckResult,
    TeachingDocument,
    TeachingSaveRequest,
    TeachingSaveResult,
    ValidationTestList,
)
from app.sessions.store import store
from services.lenses import config_diff, path_explorer, readiness, reports, search, service, teaching
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


@router.get("/search", response_model=LabSearchResult)
async def search_lab(session_id: str = Query(alias="sessionId"), q: str = Query("", max_length=200)):
    """Find nodes by address, prefix, AS, VLAN, VRF, module, group, device…
    in netlab's transformed topology (see services/lenses/search.py)."""
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        transformed = (await runner.create(session.topology_path))["snapshot"]
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(422, exc.stderr.strip() or str(exc)) from exc
    return {"results": search.search(transformed, q), "modules": search.modules(transformed)}


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


@router.get("/reports/export", response_class=Response)
async def export_report(session_id: str = Query(alias="sessionId"), name: str = Query(), download: bool = True):
    """A report in one of netlab's formats (``.md``, ``.html`` or text)."""
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        content = await reports.export(session.topology_path, name)
    except KeyError as exc:
        raise HTTPException(404, f"unknown report: {name}") from exc
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except (runner.NetlabError, RuntimeError, ValueError) as exc:
        detail = exc.stderr.strip() if isinstance(exc, runner.NetlabError) else str(exc)
        raise HTTPException(422, detail or str(exc)) from exc
    media = {"html": "text/html", "md": "text/markdown"}.get(name.rpartition(".")[2], "text/plain")
    filename = name if "." in name else f"{name}.txt"
    lab = Path(session.topology_path).parent.name
    headers = {
        "Content-Disposition": f'{"attachment" if download else "inline"}; filename="{lab}-{filename}"',
        # Report HTML is rendered from lab content: opened in a tab, it runs
        # in an opaque origin with scripts off, never as the UI's origin.
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content, media_type=f"{media}; charset=utf-8", headers=headers)


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


@router.get("/teaching/tests", response_model=ValidationTestList)
async def get_teaching_tests(session_id: str = Query(alias="sessionId")):
    """The lab's netlab validate tests — what an exercise step can check."""
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        transformed = (await runner.create(session.topology_path))["snapshot"]
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(422, exc.stderr.strip() or str(exc)) from exc
    return {"tests": teaching.validation_tests(transformed)}


@router.post("/teaching/check", response_model=TeachingCheckResult)
async def check_teaching_step(body: TeachingCheckRequest):
    """Run an exercise step's checks against the running lab."""
    try:
        session = store.require(body.sessionId)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
    try:
        return await teaching.check(session.topology_path, body.tests)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
