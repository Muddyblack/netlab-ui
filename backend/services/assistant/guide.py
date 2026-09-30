"""Tools that let an attached agent read lab monitoring and show the user the UI, live.

Monitoring tools read what the netlab ``monitoring`` plugin collects (health against the
topology, PromQL, fault-test results). UI tools drive the netlab-ui window the user has
open: open a dialog or palette action, spotlight nodes on the canvas, put an explanation
card on screen, or set up a fault test for the user to start. They push events over the
UI's event stream (``{"type": "ui", ...}``); nothing here changes the lab or the topology.

Taking links down stays the user's decision: ``ui_prepare_fault_test`` only fills in the
form, and the user presses *Run*.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from services import monitoring, monitoring_scenarios
from services.assistant.tools import ToolError, _lab_name, _session

MAX_SERIES = 200
MAX_MESSAGE = 600

MonitoringTab = Literal["health", "faults", "setup"]

# Palette actions the UI can run for a session, reported by the UI itself
# (label, what it does). Only actions that open something are reported.
_ui_actions: dict[str, list[dict[str, str]]] = {}


def set_ui_actions(session_id: str, actions: list[dict[str, str]]) -> None:
    _ui_actions[session_id] = [
        {"id": str(a.get("id", "")), "label": str(a.get("label", "")), "detail": str(a.get("detail", ""))}
        for a in actions
        if a.get("id")
    ]


def _lab_dir(session: Any) -> Path:
    return Path(session.topology_path).parent


def _push(session: Any, event: dict[str, Any]) -> None:
    from services.events import hub

    hub.publish({"type": "ui", "sessionId": session.id, **event})


def _message(text: str) -> str:
    text = text.strip()
    if len(text) > MAX_MESSAGE:
        raise ToolError(f"keep the message under {MAX_MESSAGE} characters -- the user reads it on screen")
    return text


def _ui_open(session: Any) -> None:
    if session.id not in _ui_actions:
        raise ToolError(
            "netlab-ui is not showing this lab right now (or the page is from an older version) -- "
            "ask the user to open the lab in netlab-ui"
        )


# ------------------------------------------------------------------ monitoring
async def get_monitoring(lab: str | None = None) -> dict[str, Any]:
    """Whether monitoring is on and running, where the dashboards are, and the lab's
    health against the topology (what is expected but not up)."""
    session = _session(lab)
    from app.contract import commands

    lab_dir = _lab_dir(session)
    topo = commands.load_topology(session.topology_path)
    info = monitoring.stack(lab_dir)
    running = await monitoring.running_containers(info.get("containers") or {}) if info else {}
    result: dict[str, Any] = {
        "lab": _lab_name(session),
        "enabled": monitoring.enabled(topo.attrs),
        "placement": monitoring.placement(topo.attrs),
        "running": running,
    }
    if not result["enabled"]:
        result["hint"] = "monitoring is off: ui_open_monitoring('setup') shows the user where to turn it on"
        return result
    if not info:
        result["hint"] = "monitoring is on but the lab has not been deployed with it yet"
        return result
    base = str(info.get("grafana_url") or "")
    result["dashboards"] = (
        {name: f"{base}/d/{uid}" for name, uid in (info.get("dashboards") or {}).items()} if base else {}
    )
    methods: dict[str, int] = {}
    for node in monitoring.coverage(lab_dir):
        for method in node.get("methods") or ["host"]:
            methods[method] = methods.get(method, 0) + 1
    result["collection"] = methods
    if any(running.values()):
        try:
            result["health"] = await monitoring.summary(lab_dir)
        except RuntimeError as exc:
            result["health"] = f"not available: {exc}"
    return result


async def query_metrics(promql: str, lab: str | None = None) -> dict[str, Any]:
    """Instant PromQL query against the lab's metrics store (netlab_* metrics)."""
    session = _session(lab)
    try:
        series = await monitoring.query(_lab_dir(session), promql)
    except RuntimeError as exc:
        raise ToolError(str(exc)) from exc
    result: dict[str, Any] = {"series": series[:MAX_SERIES]}
    if len(series) > MAX_SERIES:
        result["truncated"] = f"{len(series)} series, first {MAX_SERIES} shown -- aggregate (sum by ...) instead"
    return result


async def get_fault_test_results(lab: str | None = None, limit: int = 5) -> dict[str, Any]:
    """Fault tests of this lab, running first, then saved runs (newest first)."""
    session = _session(lab)
    runs = monitoring_scenarios.history(_lab_dir(session), limit=max(1, min(limit, 20)))
    return {"runs": runs}


# ------------------------------------------------------------------------- UI
async def ui_list_actions(lab: str | None = None) -> dict[str, Any]:
    """Dialogs and panels the user's netlab-ui can open right now (command palette)."""
    session = _session(lab)
    _ui_open(session)
    return {"lab": _lab_name(session), "actions": _ui_actions[session.id]}


async def ui_run_action(action_id: str, message: str = "", lab: str | None = None) -> dict[str, Any]:
    """Open a dialog or panel in the user's netlab-ui, with an optional explanation card."""
    session = _session(lab)
    _ui_open(session)
    known = {a["id"]: a for a in _ui_actions[session.id]}
    if action_id not in known:
        raise ToolError(f"unknown action {action_id!r} -- ui_list_actions shows what the UI offers")
    _push(session, {"kind": "run", "id": action_id, "message": _message(message)})
    return {"ok": True, "opened": known[action_id]["label"]}


async def ui_show_nodes(nodes: list[str], message: str = "", lab: str | None = None) -> dict[str, Any]:
    """Spotlight nodes on the user's canvas (everything else dims) with an explanation."""
    session = _session(lab)
    _ui_open(session)
    from app.contract import commands

    names = {node.name for node in commands.load_topology(session.topology_path).nodes}
    unknown = [n for n in nodes if n not in names]
    if unknown:
        raise ToolError(f"no such node(s): {', '.join(unknown)}")
    if not nodes:
        raise ToolError("name at least one node (ui_clear removes the spotlight)")
    _push(session, {"kind": "spotlight", "nodes": list(nodes), "message": _message(message)})
    return {"ok": True, "spotlighted": nodes}


async def ui_explain(message: str, title: str = "", lab: str | None = None) -> dict[str, Any]:
    """Put an explanation card on the user's screen (stays until they dismiss it)."""
    session = _session(lab)
    _ui_open(session)
    if not message.strip():
        raise ToolError("the message is empty")
    _push(session, {"kind": "explain", "title": _message(title)[:80], "message": _message(message)})
    return {"ok": True}


async def ui_clear(lab: str | None = None) -> dict[str, Any]:
    """Remove the spotlight and the explanation card."""
    session = _session(lab)
    _push(session, {"kind": "clear"})
    return {"ok": True}


async def ui_open_monitoring(tab: MonitoringTab = "health", message: str = "", lab: str | None = None) -> dict:
    """Open the Monitoring dialog on a tab (health, faults, setup)."""
    session = _session(lab)
    _ui_open(session)
    _push(session, {"kind": "monitoring", "tab": tab, "message": _message(message)})
    return {"ok": True, "tab": tab}


async def ui_prepare_fault_test(
    node: str,
    ifname: str,
    *,
    both_ends: bool = False,
    cycles: int = 3,
    down_seconds: int = 10,
    up_seconds: int = 30,
    message: str = "",
    lab: str | None = None,
) -> dict[str, Any]:
    """Fill in the Fault tests form for the user to review and start (nothing runs yet)."""
    session = _session(lab)
    _ui_open(session)
    link = next(
        (
            item
            for item in monitoring.links(_lab_dir(session))
            if (item.get("a_node"), item.get("a_ifname")) == (node, ifname)
            or (item.get("b_node"), item.get("b_ifname")) == (node, ifname)
        ),
        None,
    )
    if link is None:
        raise ToolError(
            f"{node} {ifname} is not a monitored lab link (use get_lab for interface names; "
            "monitoring must have been deployed with the lab)"
        )
    end = "both" if both_ends else ("a" if link.get("a_node") == node else "b")
    form = {
        "link": link.get("link"),
        "end": end,
        "cycles": max(1, min(int(cycles), 100)),
        "down": max(1, int(down_seconds)),
        "up": max(1, int(up_seconds)),
    }
    _push(session, {"kind": "monitoring", "tab": "faults", "faultTest": form, "message": _message(message)})
    return {
        "ok": True,
        "form": form,
        "status": "waiting for the user to press Run in the Monitoring dialog -- nothing is running yet; "
        "get_fault_test_results shows the results once it has run",
    }
