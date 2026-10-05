"""Lab insight tools (services.assistant.insight) and the file/link/capture UI tools."""

from __future__ import annotations

import asyncio

import pytest

from services.assistant import guide, insight
from services.assistant.tools import ToolError
from services.lenses import validation_results
from services.netlab import config_snapshots, runner
from tests.test_assistant_guide import _events, session  # noqa: F401  (fixture)

MODEL = {
    "provider": "clab",
    "nodes": {
        "r1": {
            "device": "frr",
            "module": ["ospf"],
            "ospf": {"area": "0.0.0.0"},
            "loopback": {"ipv4": "10.0.0.1/32"},
            "interfaces": [
                {
                    "ifname": "eth1",
                    "ipv4": "10.1.0.1/30",
                    "ospf": {"area": "0.0.0.0"},
                    "neighbors": [{"node": "r2", "ifname": "eth1"}],
                }
            ],
        },
        "r2": {"device": "frr", "interfaces": []},
    },
    "links": [{"interfaces": [{"node": "r1", "ifname": "eth1"}, {"node": "r2", "ifname": "eth1"}]}],
}


@pytest.fixture
def netlab(monkeypatch):
    async def create(path, **_kw):
        return {"snapshot": MODEL}

    async def status(_path):
        return {"nodes": {"r1": {"status": "running"}}}

    monkeypatch.setattr(runner, "create", create)
    monkeypatch.setattr(runner, "status_for", status)


def test_ui_open_file_stays_in_the_lab_folder(session, tmp_path):  # noqa: F811
    (tmp_path / "node_files" / "r1").mkdir(parents=True)
    (tmp_path / "node_files" / "r1" / "ospf").write_text("router ospf\n")
    guide.set_ui_actions(session.id, [])
    for bad in ("../x", "/etc/passwd", "node_files", "missing"):
        with pytest.raises(ToolError, match="not a file"):
            asyncio.run(guide.ui_open_file(bad))
    result, events = _events(lambda: guide.ui_open_file("node_files/r1/ospf", "the ospf config"))
    assert result["opened"] == "node_files/r1/ospf"
    assert events[0]["kind"] == "openFile" and events[0]["path"].endswith("node_files/r1/ospf")


def test_ui_show_link_needs_a_link(session, netlab):  # noqa: F811
    guide.set_ui_actions(session.id, [])
    with pytest.raises(ToolError, match="no link between"):
        asyncio.run(guide.ui_show_link("r1", "r9"))
    result, events = _events(lambda: guide.ui_show_link("r2", "r1", "the core link"))
    assert result == {"ok": True, "links": 1}
    assert events[0]["kind"] == "link" and events[0]["nodes"] == ["r2", "r1"]


def test_ui_open_capture_checks_the_node(session):  # noqa: F811
    guide.set_ui_actions(session.id, [])
    with pytest.raises(ToolError, match="no such node"):
        asyncio.run(guide.ui_open_capture("r9", "eth1"))
    _, events = _events(lambda: guide.ui_open_capture("r1", "eth1"))
    assert (events[0]["kind"], events[0]["node"], events[0]["interface"]) == ("capture", "r1", "eth1")


def test_explain_node_is_one_picture(session, netlab, tmp_path):  # noqa: F811
    (tmp_path / "node_files" / "r1").mkdir(parents=True)
    (tmp_path / "node_files" / "r1" / "ospf").write_text("x")
    result = asyncio.run(insight.explain_node("r1"))
    assert result["device"] == "frr" and result["state"] == "running"
    assert result["modules"] == {"ospf": {"area": "0.0.0.0"}}
    assert result["interfaces"][0]["to"] == "r2:eth1" and result["interfaces"][0]["ospf"] == {"area": "0.0.0.0"}
    assert result["config_files"] == ["ospf"]
    with pytest.raises(ToolError, match="no such node"):
        asyncio.run(insight.explain_node("r9"))


def test_compare_configs(session, monkeypatch):  # noqa: F811
    assert "no config snapshot" in asyncio.run(insight.compare_configs())["note"]
    monkeypatch.setattr(config_snapshots, "list_snapshots", lambda _p: [{"id": "s2", "reason": "now"}, {"id": "s1"}])
    texts = {"s1": "hostname r1\nrouter ospf\n", "s2": "hostname r1\nrouter ospf\nrouter bgp 65000\n"}
    monkeypatch.setattr(config_snapshots, "read_snapshot", lambda _p, snap, _node: texts.get(snap))

    async def live(_p, nodes):
        return dict.fromkeys(nodes, texts["s2"])

    monkeypatch.setattr(config_snapshots, "fetch_running", live)
    result = asyncio.run(insight.compare_configs("r1", snapshot="s1"))
    assert "+router bgp 65000" in result["diff"]
    assert "(identical)" in asyncio.run(insight.compare_configs("r1", snapshot="s2"))["diff"]
    assert "router bgp" in asyncio.run(insight.compare_configs("r1", snapshot="s1", against="s2"))["diff"]
    with pytest.raises(ToolError, match="no snapshot"):
        asyncio.run(insight.compare_configs("r1", snapshot="nope"))


def test_validation_results_report_failures_with_evidence(session):  # noqa: F811
    assert "run=True" in asyncio.run(insight.get_validation_results())["hint"]
    validation_results.store(
        session.topology_path,
        "bgp_up: PASS\nospf_adj: FAIL neighbor 10.0.0.2 not in FULL state\n",
        ["bgp_up", "ospf_adj"],
    )
    result = asyncio.run(insight.get_validation_results())
    assert result["counts"] == {"passed": 1, "failed": 1}
    assert result["tests"]["bgp_up"] == {"state": "passed"}
    assert "not in FULL" in result["tests"]["ospf_adj"]["evidence"]


def test_node_config_text_leaves_out_template_comments_unless_raw(session, tmp_path):  # noqa: F811
    (tmp_path / "node_files" / "r1").mkdir(parents=True)
    body = "# generated by template\n# more comments\n\nrouter ospf\n!\n\n\nbgp 65000\n"
    (tmp_path / "node_files" / "r1" / "daemons").write_text(body)
    result = asyncio.run(guide.get_node_configs("r1", "daemons"))
    assert result["text"] == "router ospf\n\nbgp 65000\n" and "5 lines" in result["comments_left_out"]
    assert asyncio.run(guide.get_node_configs("r1", "daemons", raw=True))["text"] == body


def test_running_validation_reports_pass_and_wraps_unparsed_output(session, netlab, monkeypatch):  # noqa: F811
    async def failing(_path):
        return runner.CommandResult(1, "FAIL: bgp session down", "")

    monkeypatch.setattr(runner, "validate", failing)
    result = asyncio.run(insight.get_validation_results(run=True))
    assert result["passed"] is False and result["output"].startswith("UNTRUSTED")
    assert "bgp session down" in result["output"]

    async def no_tests(_path):
        return runner.CommandResult(1, "", "Fatal error in netlab: No validation tests defined for the current lab")

    monkeypatch.setattr(runner, "validate", no_tests)
    assert "no validation tests" in asyncio.run(insight.get_validation_results(run=True))["note"]


def test_ui_open_and_highlight_pick_the_right_target(session, netlab, tmp_path):  # noqa: F811
    (tmp_path / "notes.md").write_text("x")
    guide.set_ui_actions(session.id, [{"id": "action:reports", "label": "Reports"}])
    cases = [
        (lambda: guide.ui_open("action", "action:reports"), "run"),
        (lambda: guide.ui_open("file", "notes.md"), "openFile"),
        (lambda: guide.ui_open("node_configs", "r1"), "nodeConfigs"),
        (lambda: guide.ui_open("capture", "r1", "eth1"), "capture"),
        (lambda: guide.ui_open("monitoring", "faults"), "monitoring"),
        (lambda: guide.ui_open("monitoring"), "monitoring"),
        (lambda: guide.ui_highlight(["r1", "r2"]), "spotlight"),
        (lambda: guide.ui_highlight(["r1", "r2"], link=True), "link"),
    ]
    for work, kind in cases:
        _, events = _events(work)
        assert [e["kind"] for e in events] == [kind]
    with pytest.raises(ToolError, match="health, faults and setup"):
        asyncio.run(guide.ui_open("monitoring", "nope"))
    with pytest.raises(ToolError, match="exactly two"):
        asyncio.run(guide.ui_highlight(["r1"], link=True))


def test_the_new_tools_are_on_the_mcp_server():
    from services.assistant import mcp_server

    assert {
        "ui_open", "ui_highlight", "get_reports", "compare_configs",
        "get_validation_results", "explain_node", "capture_packets", "read_capture",
    } <= set(mcp_server.tool_names())  # fmt: skip
