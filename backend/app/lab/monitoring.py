"""Lab monitoring (the netlab ``monitoring`` plugin): state, on/off, health, PromQL.

See :mod:`services.monitoring`. Turning monitoring on edits the lab's ``plugin:``
list; netlab renders the stack at the next deploy (``netlab up``) and starts it
with the lab.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.lab import common
from app.sessions.store import store
from services import fault_tests, monitoring, monitoring_scenarios
from services.netlab import tools

router = APIRouter()


class MonitoringNode(BaseModel):
    node: str
    device: str = ""
    provider: str = ""
    methods: list[str] = []


class MonitoringLink(BaseModel):
    link: str
    a_node: str
    a_ifname: str
    b_node: str = ""
    b_ifname: str = ""


class MonitoringState(BaseModel):
    pluginAvailable: bool
    pluginInstalled: bool
    pluginPath: str
    enabled: bool
    placement: Literal["tool", "node"] = "tool"
    logs: bool = False
    webhook: str = ""
    slack: str = ""
    # An email alert target exists in the topology (edited there, not in the UI).
    email: bool = False
    labDeployed: bool
    rendered: bool
    running: dict[str, bool] = {}
    grafanaPort: int | None = None
    tsdbPort: int | None = None
    dashboards: dict[str, str] = {}
    coverage: list[MonitoringNode] = []
    links: list[MonitoringLink] = []


class MonitoringToggle(BaseModel):
    sessionId: str
    enabled: bool
    placement: Literal["tool", "node"] | None = None
    # Opt-in parts of the stack; left as they are when omitted, an empty address removes a target.
    logs: bool | None = None
    webhook: str | None = None
    slack: str | None = None


class MissingItem(BaseModel):
    protocol: str
    node: str
    peer: str
    detail: str = ""


class MonitoringSummary(BaseModel):
    nodes: int = 0
    nodesUp: int = 0
    bgpUp: int = 0
    bgpExpected: int = 0
    ospfUp: int = 0
    ospfExpected: int = 0
    isisUp: int = 0
    isisExpected: int = 0
    missing: list[MissingItem] = []


class PromSample(BaseModel):
    labels: dict[str, str]
    value: float


class MonitoringAction(BaseModel):
    sessionId: str
    action: Literal["up", "down"]


class MonitoringActionResult(BaseModel):
    code: int
    stdout: str
    stderr: str


class MonitoringEvent(BaseModel):
    sessionId: str
    text: str
    tags: list[str] = []


async def _state(path: str) -> MonitoringState:
    lab_dir = Path(path).parent
    topo = commands.load_topology(path)
    plugin = monitoring.plugin_state()
    info = monitoring.stack(lab_dir)
    running = await monitoring.running_containers(info.get("containers") or {}) if info else {}
    return MonitoringState(
        pluginAvailable=plugin["available"],
        pluginInstalled=plugin["installed"],
        pluginPath=plugin["path"],
        enabled=monitoring.enabled(topo.attrs),
        placement=monitoring.placement(topo.attrs),
        logs=monitoring.logs_enabled(topo.attrs),
        **monitoring.notify_targets(topo.attrs),
        labDeployed=tools.is_deployed(lab_dir),
        rendered=bool(info),
        running=running,
        grafanaPort=info.get("grafana_port"),
        tsdbPort=info.get("tsdb_port"),
        dashboards=info.get("dashboards") or {},
        coverage=[MonitoringNode(**item) for item in monitoring.coverage(lab_dir)],
        links=[MonitoringLink(**item) for item in monitoring.links(lab_dir)],
    )


@router.get("/monitoring", response_model=MonitoringState)
async def get_monitoring(sessionId: str):
    return await _state(common.session_path(sessionId))


@router.put("/monitoring", response_model=MonitoringState)
async def toggle_monitoring(body: MonitoringToggle):
    """Turn the plugin on/off for the lab (installing it for netlab if needed).
    Takes effect when the lab is next deployed."""
    session = store.get(body.sessionId)
    if session is None:
        raise HTTPException(404, "unknown session")
    if body.enabled:
        try:
            monitoring.install_plugin()
        except (OSError, RuntimeError) as exc:
            raise HTTPException(409, f"Cannot install the monitoring plugin: {exc}") from exc
    topo = commands.load_topology(session.topology_path)
    try:
        monitoring.set_enabled(topo.attrs, body.enabled, body.placement)
        monitoring.set_options(topo.attrs, body.logs, body.webhook, body.slack)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return await _state(session.topology_path)


@router.get("/monitoring/summary", response_model=MonitoringSummary)
async def monitoring_summary(sessionId: str):
    """Live health: nodes up and sessions/adjacencies up vs what the topology expects."""
    try:
        return MonitoringSummary(**await monitoring.summary(Path(common.session_path(sessionId)).parent))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/monitoring/query", response_model=list[PromSample])
async def monitoring_query(sessionId: str, query: str):
    """Instant PromQL query against the lab's metrics (read-only)."""
    if len(query) > 2000:
        raise HTTPException(400, "query too long")
    try:
        return await monitoring.query(Path(common.session_path(sessionId)).parent, query)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/monitoring/action", response_model=MonitoringActionResult)
async def monitoring_action(body: MonitoringAction):
    """Start or stop the stack of a deployed lab now (``netlab up`` starts it anyway).
    With ``placement: node`` the containers are lab nodes and follow the lab."""
    lab_dir = Path(common.session_path(body.sessionId)).parent
    if monitoring.stack(lab_dir).get("placement") == "node":
        raise HTTPException(409, "The monitoring containers are lab nodes here -- they start and stop with the lab.")
    result = await tools.action(lab_dir, monitoring.PLUGIN, body.action)
    return {"code": result.code, "stdout": result.stdout, "stderr": result.stderr}


@router.post("/monitoring/event")
async def monitoring_event(body: MonitoringEvent) -> dict[str, bool]:
    """Mark an event (e.g. a link taken down from the UI) on the lab's dashboards."""
    lab_dir = Path(common.session_path(body.sessionId)).parent
    return {"ok": await monitoring.annotate(lab_dir, body.text[:500], [t[:40] for t in body.tags[:5]])}


class ScenarioLinkEnd(BaseModel):
    node: str
    ifname: str


class ScenarioRequest(BaseModel):
    """Either a fault test the topology defines (`name`), or links and timing."""

    sessionId: str
    name: str | None = None
    links: list[ScenarioLinkEnd] = []
    cycles: int = 3
    downSeconds: float = 10
    upSeconds: float = 30
    settleSeconds: float = 120
    validateAfter: list[str] | None = None  # netlab validate tests after recovery ([] = all)
    validateDuring: list[str] | None = None
    expectRecovery: float | None = None


class ValidationCheck(BaseModel):
    test: str
    description: str = ""
    passed: bool | None = None
    seconds: float | None = None
    message: str = ""


class ScenarioCycle(BaseModel):
    cycle: int
    downAt: float
    upAt: float = 0
    reactionSeconds: float | None = None
    impact: int = 0
    recoverySeconds: float | None = None
    recoveryExact: bool = False
    affected: list[str] = []
    during: list[ValidationCheck] = []
    after: list[ValidationCheck] = []


class ScenarioStats(BaseModel):
    min: float
    avg: float
    max: float


class ScenarioVerdict(BaseModel):
    result: str  # passed | failed | running | cancelled
    reasons: list[str] = []


class ScenarioSummary(BaseModel):
    reaction: ScenarioStats | None = None
    recovery: ScenarioStats | None = None
    notRecovered: int = 0
    verdict: ScenarioVerdict | None = None


class ScenarioRun(BaseModel):
    id: str
    lab: str
    links: list[ScenarioLinkEnd]
    cycles: int
    downSeconds: float
    upSeconds: float
    settleSeconds: float
    status: str
    message: str = ""
    startedAt: float
    finishedAt: float | None = None
    baselineMissing: int = 0
    results: list[ScenarioCycle] = []
    summary: ScenarioSummary
    name: str = ""
    description: str = ""
    validateAfter: list[str] | None = None
    validateDuring: list[str] | None = None
    expectRecovery: float | None = None


class FaultTest(BaseModel):
    name: str
    description: str = ""
    links: list[str] = []
    cycles: int
    down: float
    up: float
    settle: float
    validateAfter: list[str] | None = None  # topology key: validate
    validateDuring: list[str] | None = None  # topology key: during
    expectRecovery: float | None = None


class LabValidationTest(BaseModel):
    name: str
    description: str = ""


class FaultTests(BaseModel):
    faults: list[FaultTest] = []
    validationTests: list[LabValidationTest] = []


@router.post("/monitoring/scenarios", response_model=ScenarioRun)
async def start_scenario(body: ScenarioRequest):
    """Flap links on a schedule and measure reaction and recovery against the topology."""
    path = common.session_path(body.sessionId)
    lab_dir = Path(path).parent
    try:
        if body.name:
            return monitoring_scenarios.start_named(lab_dir, commands.load_topology(path).attrs, body.name)
        return monitoring_scenarios.start(
            lab_dir,
            [end.model_dump() for end in body.links],
            body.cycles,
            body.downSeconds,
            body.upSeconds,
            body.settleSeconds,
            validate_after=body.validateAfter,
            validate_during=body.validateDuring,
            expect_recovery=body.expectRecovery,
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/monitoring/faults", response_model=FaultTests)
async def fault_test_definitions(sessionId: str):
    """Fault tests the topology defines (monitoring.faults) and its netlab validation tests."""
    attrs = commands.load_topology(common.session_path(sessionId)).attrs
    return {"faults": fault_tests.definitions(attrs), "validationTests": fault_tests.validation_tests(attrs)}


@router.get("/monitoring/scenarios", response_model=list[ScenarioRun])
async def list_scenarios(sessionId: str):
    """Running scenarios of the lab, then the saved results (newest first)."""
    return monitoring_scenarios.history(Path(common.session_path(sessionId)).parent)


@router.get("/monitoring/scenarios/{scenario_id}", response_model=ScenarioRun)
async def get_scenario(scenario_id: str):
    data = monitoring_scenarios.get(scenario_id)
    if data is None:
        raise HTTPException(404, "unknown scenario")
    return data


@router.post("/monitoring/scenarios/{scenario_id}/cancel")
async def cancel_scenario(scenario_id: str) -> dict[str, bool]:
    """Stop a running scenario; its links are brought back up."""
    return {"ok": monitoring_scenarios.cancel(scenario_id)}
