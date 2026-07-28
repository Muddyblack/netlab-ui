"""Lab lifecycle endpoints: ``netlab up``/``down`` and live status.

Per clab-ui's contract, deployment/lifecycle is the host product's job (not
clab-ui's), so it lives here rather than in the topology contract. Status is
exposed both as a one-shot GET and as a Server-Sent Events stream the lifecycle
bar subscribes to for live per-node badges. All connected stream clients share
one ``netlab status`` poll loop (the CLI costs seconds per run), which also
keeps :func:`runner.status_cached` warm for snapshot builds.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.contract.responses import (
    CommandResult,
    DeployDiffResult,
    DeploymentLog,
    DeploymentNodeDetail,
    DeploymentOverview,
    LabInstance,
    LabInstanceAction,
    RuntimeContainer,
    ValidationResult,
    VersionResult,
)
from app.lab import common
from services.netlab import deploy_diff, deployment, runner
from services.netlab import runtime as runtime_state
from services.netlab import validation as validation_store
from services.netlab.logfmt import LineFilter

router = APIRouter()
logger = logging.getLogger(__name__)


class LabAction(BaseModel):
    sessionId: str


class FcliAction(LabAction):
    command: str


@router.get("/instances", response_model=list[LabInstance])
async def lab_instances():
    try:
        status = await runner.status()
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        # netlab returns 1 when there are simply no tracked labs.
        if "No netlab-managed labs" in exc.stderr:
            return []
        raise HTTPException(500, str(exc)) from exc
    if not isinstance(status, dict):
        return []
    return [
        {
            "id": str(instance_id),
            "name": str(info.get("name") or instance_id),
            "directory": str(info.get("dir") or ""),
            "status": str(info.get("status") or "Unknown"),
            "providers": [str(provider) for provider in info.get("providers", [])],
            "directoryExists": bool(info.get("dir")) and Path(str(info["dir"])).is_dir(),
        }
        for instance_id, info in status.items()
        if isinstance(info, dict)
    ]


@router.post("/instances/{instance_id}/action", response_model=CommandResult)
async def lab_instance_action(instance_id: str, body: LabInstanceAction):
    try:
        result = await runner.manage_instance(instance_id, body.action)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": result.code, "stdout": result.stdout, "stderr": result.stderr}


@router.post("/instances/{instance_id}/force-cleanup/stream")
async def lab_instance_force_cleanup_stream(instance_id: str):
    """Stream 'force cleanup' output live for the Running Labs dialog.

    Unlike ``/lifecycle/stream``, this needs no session or topology path: the
    instance comes from netlab's global registry and its directory may not
    even exist any more. Frames match ``/lifecycle/stream``'s shape
    (``{stream, line}`` then ``{done, code}``) so the same simple parsing works.
    """

    async def gen():
        fmt = LineFilter()
        try:
            async for stream, line in runner.force_cleanup_stream(instance_id):
                if stream == "exit":
                    for out_stream, out_line in fmt.flush():
                        yield f"data: {json.dumps({'stream': out_stream, 'line': out_line})}\n\n"
                    yield f"data: {json.dumps({'done': True, 'code': int(line)})}\n\n"
                else:
                    for out_stream, out_line in fmt.feed(stream, line):
                        yield f"data: {json.dumps({'stream': out_stream, 'line': out_line})}\n\n"
        except runner.NetlabNotInstalled as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        except (OSError, UnicodeError, ValueError):
            logger.exception("Forced cleanup failed")
            yield f"data: {json.dumps({'error': 'Forced cleanup failed.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers=common.SSE_HEADERS)


@router.post("/up", response_model=CommandResult)
async def lab_up(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.up(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    if res.code == 0:
        deploy_diff.record(path)
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.get("/deploy-diff", response_model=DeployDiffResult)
def lab_deploy_diff(sessionId: str):
    return deploy_diff.compare(common.session_path(sessionId))


@router.get("/deployment", response_model=DeploymentOverview)
def lab_deployment(sessionId: str):
    return deployment.overview(common.session_path(sessionId))


@router.get("/deployment/node", response_model=DeploymentNodeDetail)
def lab_deployment_node(sessionId: str, node: str):
    return deployment.node_detail(common.session_path(sessionId), node)


@router.get("/deployment/log", response_model=DeploymentLog)
def lab_deployment_log(sessionId: str):
    """Verbatim output of the most recent lifecycle run for this lab, retained
    so the transcript is still reachable after clab-ui's progress modal closes."""
    return deployment.log(common.session_path(sessionId))


@router.get("/runtime", response_model=list[RuntimeContainer])
async def lab_runtime(sessionId: str):
    path = common.session_path(sessionId)
    from app.contract import commands

    try:
        return await runtime_state.collect(path, commands.load_topology(path))
    except (runner.NetlabError, runner.NetlabNotInstalled):
        return []


class NodeAction(BaseModel):
    sessionId: str
    node: str
    action: str


async def _running_node_info(session_id: str, node: str) -> tuple[str, dict[str, Any]]:
    """Resolve (topology_path, node status entry) for a node of the running
    lab behind ``session_id``; raises HTTPException when unavailable."""
    path = common.session_path(session_id)
    try:
        status = await runner.status_for(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        raise HTTPException(409, f"Lab status unavailable: {exc}") from exc
    nodes = status.get("nodes") if isinstance(status, dict) else None
    info = (nodes or {}).get(node) if isinstance(nodes, dict) else None
    if not isinstance(info, dict):
        raise HTTPException(404, f"Node {node!r} is not part of the running lab")
    return path, info


def _require_clab_node(node: str, info: dict[str, Any]) -> str:
    """Container name for a clab-provided node; 409 for other providers."""
    if info.get("provider") != "clab":
        raise HTTPException(
            409,
            f"Node {node!r} runs under provider {info.get('provider')!r}; "
            "this action is only supported for containerlab nodes",
        )
    return str(info.get("provider_name") or node)


@router.post("/node-action", response_model=CommandResult)
async def lab_node_action(body: NodeAction):
    """Act on a single lab node.

    ``start``/``stop``/``restart``/``pause``/``unpause`` drive the node's
    container via the configured runtime (with a `containerlab apply`
    reconcile on containerlab 0.77+ so links come back after start/restart).
    ``save`` collects the node's device configuration via
    ``netlab collect -l <node>``."""
    if body.action != "save" and body.action not in runner.NODE_ACTIONS:
        raise HTTPException(400, f"Unsupported node action {body.action!r}")
    path, info = await _running_node_info(body.sessionId, body.node)
    if body.action == "save":
        result = await runner.run_command(["collect", "-l", body.node], cwd=Path(path).parent)
        return {"code": result.code, "stdout": result.stdout, "stderr": result.stderr}
    from app.contract import commands

    container = _require_clab_node(body.node, info)
    topo = commands.load_topology(path)
    result = await runner.container_action(
        container,
        body.action,
        preferred_runtime=runtime_state.clab_runtime(topo),
        lab_dir=Path(path).parent,
    )
    return {"code": result.code, "stdout": result.stdout, "stderr": result.stderr}


class LinkImpairment(BaseModel):
    sessionId: str
    node: str
    interface: str
    delay: str = ""
    jitter: str = ""
    loss: str = ""
    rate: str = ""
    corruption: str = ""


@router.post("/link-impairment", response_model=CommandResult)
async def lab_link_impairment(body: LinkImpairment):
    """Apply (or clear, when every field is empty) netem impairments on one
    node interface via `containerlab tools netem set`."""
    _, info = await _running_node_info(body.sessionId, body.node)
    container = _require_clab_node(body.node, info)
    result = await runner.netem_set(
        container,
        body.interface,
        delay=body.delay,
        jitter=body.jitter,
        loss=body.loss,
        rate=body.rate,
        corruption=body.corruption,
    )
    return {"code": result.code, "stdout": result.stdout, "stderr": result.stderr}


class LifecycleStreamAction(BaseModel):
    sessionId: str
    action: str


@router.post("/lifecycle/stream")
async def lab_lifecycle_stream(body: LifecycleStreamAction):
    """Run a netlab lifecycle command and stream its output live as SSE.

    Frames: ``{stream, line}`` per output line, then ``{done: true, code}``
    with the real exit code; ``{error}`` if the command could not be run.
    """
    if body.action not in runner.LIFECYCLE_ACTIONS:
        raise HTTPException(400, f"unknown lifecycle action {body.action!r}")
    path = common.session_path(body.sessionId)
    args, cwd = runner.lifecycle_argv(body.action, path)

    async def gen():
        # Clean raw netlab output for the plain-text modal: strip ANSI, fold
        # Python tracebacks into one concise ERROR line, and tag error/warning
        # lines onto stderr so the modal styles them as problems.
        fmt = LineFilter()
        captured: list[str] = []
        tracker = None
        if body.action in {"up", "down", "restart", "initial", "create-configs"}:
            from app.contract import commands

            tracker = deployment.start(
                path,
                body.action,
                [node.name for node in commands.load_topology(path).nodes],
            )
            yield f"data: {json.dumps({'progress': tracker.payload(delta=True)})}\n\n"
        try:
            yield f"data: {json.dumps({'stream': 'stdout', 'line': f'Running netlab {args[0]}…'})}\n\n"
            async for stream, line in runner.run_streaming(args, cwd=cwd):
                if stream == "exit":
                    for out_stream, out_line in fmt.flush():
                        yield f"data: {json.dumps({'stream': out_stream, 'line': out_line})}\n\n"
                    done_payload: dict[str, Any] = {"done": True, "code": int(line)}
                    transcript = "".join(captured)
                    if body.action == "up" and "already running in directory" in transcript:
                        done_payload["hint"] = (
                            "Another netlab instance owns this instance ID. "
                            "Open Explorer → Running Labs → Manage running labs."
                        )
                    if tracker:
                        tracker.finish(int(line))
                        done_payload["progress"] = tracker.payload(delta=True)
                    if body.action == "up" and int(line) == 0:
                        deploy_diff.record(path)
                    if body.action == "validate":
                        issues = _store_validation(path, transcript)
                        done_payload["issues"] = [issue.as_dict() for issue in issues]
                    yield f"data: {json.dumps(done_payload)}\n\n"
                else:
                    captured.append(line)
                    if tracker:
                        changed = tracker.feed(line)
                        # Classify the line after parsing it so section filters
                        # include the first line that transitions to a stage.
                        tracker.record_log(stream, line)
                        if changed:
                            yield f"data: {json.dumps({'progress': tracker.payload(delta=True)})}\n\n"
                    for out_stream, out_line in fmt.feed(stream, line):
                        yield f"data: {json.dumps({'stream': out_stream, 'line': out_line})}\n\n"
        except asyncio.CancelledError:
            if tracker:
                tracker.finish(130)
            raise
        except runner.NetlabNotInstalled as exc:
            if tracker:
                tracker.finish(1)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        except (OSError, UnicodeError, ValueError):
            if tracker:
                tracker.finish(1)
            logger.exception("Lab deployment stream failed")
            yield f"data: {json.dumps({'error': 'Lab deployment failed.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers=common.SSE_HEADERS)


@router.post("/down", response_model=CommandResult)
async def lab_down(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.down(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.get("/status", response_model=dict[str, Any])
async def lab_status():
    if not runner.is_installed():
        return {}
    try:
        return await runner.status()
    except runner.NetlabError as exc:
        raise HTTPException(500, str(exc)) from exc


class _StatusBroadcaster:
    """One shared ``netlab status`` poll loop feeding every stream client.

    Previously each connected SSE client ran its own poll loop, so N open tabs
    cost N CLI runs per tick. The loop only runs while someone is subscribed,
    and every :func:`runner.status` call refreshes the shared TTL cache that
    snapshot builds read — so an open UI keeps snapshots status-fresh for free.
    """

    def __init__(self, interval: float = 5.0) -> None:
        self._interval = interval
        self._subscribers: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self._last: object = {}

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._subscribers.add(q)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    async def _run(self) -> None:
        try:
            while self._subscribers:
                payload: object = {}
                if runner.is_installed():
                    try:
                        payload = await runner.status()
                    except (runner.NetlabError, runner.NetlabNotInstalled):
                        # Transient `netlab status` failure: re-emit the last
                        # known state instead of {} so running labs don't
                        # flicker out of the explorer for one poll cycle.
                        # NetlabNotInstalled can fire mid `uvicorn --reload` even
                        # though is_installed() just passed — catching it here
                        # keeps the shared poll loop alive instead of letting the
                        # task die and freezing live status until a page reload.
                        payload = self._last
                self._last = payload
                for q in list(self._subscribers):
                    # A full queue means a slow client; it catches up on the next tick.
                    with contextlib.suppress(asyncio.QueueFull):
                        q.put_nowait(payload)
                await asyncio.sleep(self._interval)
        finally:
            self._task = None


_status_broadcaster = _StatusBroadcaster()


@router.get("/status/stream")
async def lab_status_stream(interval: float = 5.0):  # noqa: ARG001 — kept for API compat; poll cadence is shared
    """SSE stream of ``netlab status`` snapshots from the shared poll loop."""

    async def gen():
        q = _status_broadcaster.subscribe()
        try:
            while True:
                payload = await q.get()
                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            _status_broadcaster.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=common.SSE_HEADERS)


@router.post("/restart", response_model=CommandResult)
async def lab_restart(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.restart(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.post("/collect", response_model=CommandResult)
async def lab_collect(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.collect(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.post("/validate", response_model=ValidationResult)
async def lab_validate(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.validate(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    issues = _store_validation(path, f"{res.stdout}\n{res.stderr}")
    await _store_validation_results(path, f"{res.stdout}\n{res.stderr}")
    return {
        "code": res.code,
        "stdout": res.stdout,
        "stderr": res.stderr,
        "issues": [issue.as_dict() for issue in issues],
    }


async def _store_validation_results(path: str, output: str) -> None:
    """Parse per-test PASS/FAIL for the Validation dashboard. Best-effort: test
    names come from the transformed topology's ``validate:`` block (``create``
    is hash-cached, so this does not re-run netlab on a warm cache)."""
    from services.lenses import validation_results

    try:
        artifact = await runner.create(path)
    except (runner.NetlabError, runner.NetlabNotInstalled, OSError, json.JSONDecodeError):
        return
    snapshot = artifact.get("snapshot") if isinstance(artifact, dict) else None
    tests = snapshot.get("validate") if isinstance(snapshot, dict) else None
    names = (
        [str(test.get("name")) for test in tests if isinstance(test, dict) and test.get("name")]
        if isinstance(tests, list)
        else []
    )
    validation_results.store(path, output, names)


@router.post("/preflight", response_model=ValidationResult)
async def lab_preflight(body: LabAction):
    """Transform the topology without deploying and map schema errors to canvas entities."""
    path = common.session_path(body.sessionId)
    try:
        result = await runner.create(path)
        stdout = str(result.get("stdout") or "")
        stderr = str(result.get("stderr") or "")
        code = 0
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    except runner.NetlabError as exc:
        stdout = ""
        stderr = exc.stderr
        code = exc.code
    issues = _store_validation(path, f"{stdout}\n{stderr}")
    if code != 0 and not issues:
        issues = validation_store.store_failure(path, stderr or "netlab create failed")
    return {
        "code": code,
        "stdout": stdout,
        "stderr": stderr,
        "issues": [issue.as_dict() for issue in issues],
    }


def _store_validation(path: str, output: str):
    """Associate textual diagnostics with model entities for canvas badges."""
    from app.contract import commands

    topo = commands.load_topology(path)
    return validation_store.store(
        path,
        output,
        [node.name for node in topo.nodes],
        [tuple(link.endpoints[:2]) for link in topo.links if len(link.endpoints) >= 2],
    )


@router.post("/graph", response_model=CommandResult)
async def lab_graph(body: LabAction, output_format: str = "d2"):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.graph(path, output_format)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.post("/graph/drawio", response_model=CommandResult)
async def lab_graph_drawio(body: LabAction, layout: str = "vertical"):
    path = common.session_path(body.sessionId)
    res = await runner.export_drawio(path, layout)
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.post("/inspect", response_model=CommandResult)
async def lab_inspect(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.inspect(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.post("/fcli", response_model=CommandResult)
async def lab_fcli(body: FcliAction):
    if body.command not in runner.FCLI_COMMANDS:
        raise HTTPException(400, f"Unsupported fcli command {body.command!r}")
    res = await runner.fcli(common.session_path(body.sessionId), body.command)
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.get("/version", response_model=VersionResult)
async def netlab_version():
    if not runner.is_installed():
        return {"version": None}
    try:
        res = await runner.version()
        return {"version": res.stdout.strip(), "code": res.code}
    except (runner.NetlabError, runner.NetlabNotInstalled, OSError):
        logger.exception("Could not determine the netlab version")
        return {"version": None, "error": "Could not determine the netlab version."}


@router.post("/initial", response_model=CommandResult)
async def lab_initial(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.initial(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}


@router.post("/create-configs", response_model=CommandResult)
async def lab_create_configs(body: LabAction):
    path = common.session_path(body.sessionId)
    try:
        res = await runner.generate_configs(path)
    except runner.NetlabNotInstalled as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"code": res.code, "stdout": res.stdout, "stderr": res.stderr}
