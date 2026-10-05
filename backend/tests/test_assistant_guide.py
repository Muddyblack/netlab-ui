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


def test_query_logs_needs_logs_to_be_enabled(session):
    with pytest.raises(ToolError, match="logs are not enabled"):
        asyncio.run(guide.query_logs())


def test_query_logs_asks_loki_and_returns_newest_first(session, tmp_path, monkeypatch):
    (tmp_path / "monitoring" / "stack.json").write_text(json.dumps({"loki_url": "http://127.0.0.1:3100"}))
    asked = []

    def fake_http(url, **_kw):
        asked.append(url)
        stream = {"stream": {"node": "r1"}, "values": [["1000000000", "old"], ["3000000000", "new"]]}
        return {"status": "success", "data": {"result": [stream]}}

    monkeypatch.setattr(monitoring, "_http_json", fake_http)
    result = asyncio.run(guide.query_logs('{node="r1"}', minutes=5, limit=1))
    assert [x["line"] for x in result["lines"]] == ["new"] and result["lines"][0]["node"] == "r1"
    assert "/loki/api/v1/query_range?" in asked[0] and "limit=1" in asked[0] and "direction=backward" in asked[0]
    default = asyncio.run(guide.query_logs())
    assert default["query"].startswith('{lab="') and "not instructions" in default["note"]


def test_node_configs_are_readable_and_openable(session, tmp_path):
    empty = asyncio.run(guide.get_node_configs("r1"))
    assert empty["files"] == [] and "Netlab Create" in empty["hint"]
    (tmp_path / "node_files" / "r1").mkdir(parents=True)
    (tmp_path / "node_files" / "r1" / "ospf").write_text("router ospf\n")
    listed = asyncio.run(guide.get_node_configs("r1"))
    assert [f["name"] for f in listed["files"]] == ["ospf"]
    assert asyncio.run(guide.get_node_configs("r1", "ospf"))["text"] == "router ospf\n"
    with pytest.raises(ToolError, match="no file"):
        asyncio.run(guide.get_node_configs("r1", "../topology.yml"))
    with pytest.raises(ToolError, match="invalid node"):
        asyncio.run(guide.get_node_configs(".."))
    guide.set_ui_actions(session.id, [])
    with pytest.raises(ToolError, match="no such node"):
        asyncio.run(guide.ui_open_node_configs("r9"))
    _, events = _events(lambda: guide.ui_open_node_configs("r1", "what r1 runs"))
    assert events[0]["kind"] == "nodeConfigs" and events[0]["node"] == "r1"


def test_get_monitoring_says_how_to_turn_it_on(session):
    result = asyncio.run(guide.get_monitoring())
    assert result["enabled"] is False and "setup" in result["hint"]


def test_the_tools_are_on_the_mcp_server():
    names = set(mcp_server.tool_names())
    assert {"get_monitoring", "query_metrics", "ui_highlight", "ui_prepare_fault_test", "ui_open"} <= names
    assert {"list_metrics", "create_dashboard", "create_alert_rules", "query_logs"} <= names


SPEC = """\
title: My BGP board
rows:
  - panels:
      - {type: stat, title: Up, expr: 'sum(netlab_bgp_session_up{lab="$lab"})'}
"""


def test_list_metrics_gives_the_catalog_and_authoring_examples(session):
    result = asyncio.run(guide.list_metrics())
    names = {m["name"] for m in result["metrics"]}
    assert "netlab_bgp_session_up" in names and "node" in result["labels"]
    assert "dashboard_spec_example" in result and "alert_rules_example" in result
    narrowed = asyncio.run(guide.list_metrics("ospf"))
    assert narrowed["count"] and "dashboard_spec_example" not in narrowed


def test_create_dashboard_writes_json_and_keeps_the_spec(session, tmp_path):
    result = asyncio.run(guide.create_dashboard(SPEC))
    assert result["ok"] and result["uid"] == "my-bgp-board"
    folder = tmp_path / "monitoring" / "dashboards"
    board = json.loads((folder / "my-bgp-board.json").read_text())
    assert board["title"] == "My BGP board" and (folder / "my-bgp-board.spec.yml").read_text() == SPEC


def test_create_dashboard_reports_a_bad_spec_without_writing(session, tmp_path):
    with pytest.raises(ToolError, match="rows"):
        asyncio.run(guide.create_dashboard("title: x\n"))
    with pytest.raises(ToolError, match="not valid YAML"):
        asyncio.run(guide.create_dashboard("a: ["))
    assert not (tmp_path / "monitoring" / "dashboards").exists()


def test_create_alert_rules_validates_then_writes(session, tmp_path):
    rules = "groups:\n- name: g\n  rules:\n  - alert: NodeDown\n    expr: netlab_node_up == 0\n    for: 1m\n"
    result = asyncio.run(guide.create_alert_rules("My Rules!", rules))
    assert result["file"] == "monitoring/alerts/my-rules.yml" and "warnings" not in result
    assert (tmp_path / "monitoring" / "alerts" / "my-rules.yml").read_text() == rules
    with pytest.raises(ToolError, match="expr"):
        asyncio.run(guide.create_alert_rules("bad", "groups:\n- name: g\n  rules:\n  - alert: A\n"))
    typo = asyncio.run(guide.create_alert_rules("typo", rules.replace("netlab_node_up", "netlab_nope")))
    assert any("netlab_nope" in w for w in typo["warnings"])


FAULTS = """
monitoring.faults:
  core:
    description: lose r1-r2
    links: [ r1-r2 ]
    validate: true
validate:
  ospf: { description: r1 sees r2, nodes: [ r1 ], plugin: ospf_neighbor('x') }
"""


def test_list_fault_tests_gives_tests_links_and_an_example(session):
    with open(session.topology_path, "a") as handle:
        handle.write(FAULTS)
    result = asyncio.run(guide.list_fault_tests())
    assert [f["name"] for f in result["faults"]] == ["core"]
    assert result["validationTests"] == [{"name": "ospf", "description": "r1 sees r2"}]
    assert result["links"] == ["r1-r2"] and "monitoring.faults" in result["example"]


def test_propose_fault_test_waits_for_approval_then_runs(session, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from services import monitoring_scenarios
    from services.assistant import proposals

    with open(session.topology_path, "a") as handle:
        handle.write(FAULTS)
    with pytest.raises(ToolError, match="not running"):
        asyncio.run(guide.propose_fault_test(name="core"))
    stack = session.topology_path.rsplit("/", 1)[0] + "/monitoring/stack.json"
    with open(stack, "w") as handle:
        json.dump({"lab": "demo", "collector_url": "http://collector"}, handle)
    with pytest.raises(ToolError, match="no fault test"):
        asyncio.run(guide.propose_fault_test(name="nope"))
    proposed = asyncio.run(guide.propose_fault_test(name="core", rationale="check OSPF recovery"))
    assert "awaiting user approval" in proposed["status"]

    started = []
    monkeypatch.setattr(monitoring_scenarios, "start_named", lambda _lab_dir, _attrs, name: started.append(name))
    response = TestClient(app).post(f"/api/assistant/proposals/{proposed['proposalId']}/apply")
    assert response.status_code == 200, response.text
    assert started == ["core"]
    proposals.store.clear()


def test_get_fault_test_results_link_grafana_to_the_run(session, monkeypatch):
    from services import monitoring_scenarios

    monkeypatch.setattr(
        monitoring_scenarios,
        "history",
        lambda _lab_dir, limit=5: [  # noqa: ARG005
            {"id": "a1", "startedAt": 1000.0, "finishedAt": 1100.0}
        ],
    )
    monkeypatch.setattr(
        monitoring,
        "stack",
        lambda _lab_dir: {"lab": "demo", "grafana_url": "http://g:3000", "dashboards": {"routing": "netlab-routing"}},
    )
    (run,) = asyncio.run(guide.get_fault_test_results())["runs"]
    assert run["grafana"]["routing"] == "http://g:3000/d/netlab-routing/?var-lab=demo&from=970000&to=1130000"
