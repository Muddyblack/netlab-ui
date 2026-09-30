"""MCP tools that read lab monitoring and show the user the UI (services.assistant.guide)."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.sessions.store import store
from services import monitoring
from services.assistant import guide, mcp_server
from services.assistant.tools import ToolError
from services.events import hub

TOPOLOGY = "name: demo\nnodes:\n  r1:\n    device: frr\n  r2:\n    device: frr\nlinks:\n- r1-r2\n"
PLAN = {
    "links": [{"link": "r1-r2", "a_node": "r1", "a_ifname": "eth1", "b_node": "r2", "b_ifname": "eth1"}],
    "nodes": {},
}


@pytest.fixture
def session(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text(TOPOLOGY)
    (tmp_path / "monitoring").mkdir()
    (tmp_path / "monitoring" / "plan.json").write_text(json.dumps(PLAN))
    created = store.create(str(path))
    yield created
    store.delete(created.id)
    guide._ui_actions.pop(created.id, None)


def _events(work):
    """Run `work` and return the UI events it published."""

    async def run():
        queue = hub.subscribe()
        try:
            result = await work()
            events = []
            while not queue.empty():
                event = queue.get_nowait()
                if event.get("type") == "ui":
                    events.append(event)
            return result, events
        finally:
            hub.unsubscribe(queue)

    return asyncio.run(run())


def test_ui_tools_need_the_lab_open_in_the_ui(session):
    with pytest.raises(ToolError, match="not showing this lab"):
        asyncio.run(guide.ui_show_nodes(["r1"], "look"))


def test_run_action_only_opens_what_the_ui_reported(session):
    guide.set_ui_actions(session.id, [{"id": "action:reports", "label": "Reports…"}])
    with pytest.raises(ToolError, match="unknown action"):
        asyncio.run(guide.ui_run_action("action:deploy"))
    result, events = _events(lambda: guide.ui_run_action("action:reports", "netlab's reports"))
    assert result == {"ok": True, "opened": "Reports…"}
    assert events == [
        {"type": "ui", "sessionId": session.id, "kind": "run", "id": "action:reports", "message": "netlab's reports"}
    ]


def test_show_nodes_checks_names_and_keeps_messages_short(session):
    guide.set_ui_actions(session.id, [])
    with pytest.raises(ToolError, match="no such node"):
        asyncio.run(guide.ui_show_nodes(["r9"]))
    with pytest.raises(ToolError, match="under"):
        asyncio.run(guide.ui_explain("x" * 1000))
    _, events = _events(lambda: guide.ui_show_nodes(["r1", "r2"], "the two routers"))
    assert events[0]["kind"] == "spotlight" and events[0]["nodes"] == ["r1", "r2"]


def test_prepare_fault_test_fills_the_form_for_either_link_end(session):
    guide.set_ui_actions(session.id, [])
    with pytest.raises(ToolError, match="not a monitored lab link"):
        asyncio.run(guide.ui_prepare_fault_test("r1", "eth9"))
    result, events = _events(lambda: guide.ui_prepare_fault_test("r2", "eth1", cycles=500, down_seconds=5))
    assert result["form"] == {"link": "r1-r2", "end": "b", "cycles": 100, "down": 5, "up": 30}
    assert "nothing is running" in result["status"]
    assert events[0]["kind"] == "monitoring" and events[0]["tab"] == "faults"


def test_query_metrics_caps_the_answer(session, monkeypatch):
    async def fake_query(_lab_dir, _promql):
        return [{"labels": {"node": f"r{i}"}, "value": 1.0} for i in range(guide.MAX_SERIES + 5)]

    monkeypatch.setattr(monitoring, "query", fake_query)
    result = asyncio.run(guide.query_metrics("netlab_node_up"))
    assert len(result["series"]) == guide.MAX_SERIES and "truncated" in result


def test_get_monitoring_says_how_to_turn_it_on(session):
    result = asyncio.run(guide.get_monitoring())
    assert result["enabled"] is False and "setup" in result["hint"]


def test_the_tools_are_on_the_mcp_server():
    names = set(mcp_server.tool_names())
    assert {"get_monitoring", "query_metrics", "ui_show_nodes", "ui_prepare_fault_test", "ui_run_action"} <= names
