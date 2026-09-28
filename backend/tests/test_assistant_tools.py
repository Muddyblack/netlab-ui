"""The MCP tool surface.

Tools are plain async functions, so they are tested by calling them; the MCP
transport is exercised separately (see ``test_assistant_mcp.py``).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.sessions.store import store
from services.assistant import proposals, tools
from services.netlab import runner

TOPOLOGY = "name: demo\nnodes:\n  r1:\n    device: frr\n  r2:\n    device: frr\nlinks:\n- r1-r2\n"


@pytest.fixture
def session(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text(TOPOLOGY)
    (tmp_path / "notes.md").write_text("lab notes")
    (tmp_path / "secret.bin").write_bytes(b"\x00\x01")
    created = store.create(str(path))
    yield created
    store.delete(created.id)
    proposals.store.clear()


def _running(monkeypatch, nodes=("r1", "r2")):
    async def fake_status_for(path, max_age=4.0):
        return {"nodes": {n: {"status": "Up 5 minutes"} for n in nodes}}

    monkeypatch.setattr(runner, "status_for", fake_status_for)


def _spawn_answering(monkeypatch, answers, spawned=None):
    """Fake `netlab exec`: each node answers with answers[node]."""

    async def fake_spawn(args, cwd=None):
        node = args[1]
        if spawned is not None:
            spawned.append(args)

        class Done:
            returncode = 0
            pid = 1

            async def communicate(self):
                return answers[node].encode(), b""

        return Done()

    monkeypatch.setattr(runner, "spawn_command", fake_spawn)


def test_unknown_lab_is_an_actionable_error(session):
    with pytest.raises(tools.ToolError) as excinfo:
        asyncio.run(tools.get_topology_yaml(lab="nope"))
    assert "open labs: demo" in str(excinfo.value)


def test_lab_defaults_to_the_one_the_user_opened_last(session):
    assert asyncio.run(tools.get_topology_yaml())["yaml"] == TOPOLOGY


def test_lab_can_be_named_by_name_file_or_session_id(session):
    for name in ("demo", "topology.yml", session.id, Path(session.topology_path).parent.name):
        assert asyncio.run(tools.get_topology_yaml(lab=name))["revision"] == session.revision


@pytest.mark.parametrize("filename", ["topology.yml", "topology.yaml", "sample.yml"])
def test_lab_without_explicit_name_uses_folder_or_filename(tmp_path, monkeypatch, filename):
    path = tmp_path / filename
    path.write_text("nodes: [r1]\n")
    session = store.create(str(path))
    monkeypatch.setattr(runner, "is_installed", lambda: False)
    expected = "sample" if filename == "sample.yml" else tmp_path.name
    try:
        listed = asyncio.run(tools.list_labs())
        assert {"lab": expected, "file": str(path), "deployed": False} in listed["labs"]
        assert asyncio.run(tools.get_topology_yaml(lab=expected))["file"] == str(path)
    finally:
        store.delete(session.id)


def test_explicit_lab_name_is_preserved(session, monkeypatch):
    Path(session.topology_path).write_text("name: lab\nnodes: [r1]\n")
    monkeypatch.setattr(runner, "is_installed", lambda: False)
    assert asyncio.run(tools.list_labs())["default"] == "lab"


def test_list_labs_lists_each_topology_once(session, monkeypatch):
    second = store.create(session.topology_path)  # the same lab open twice
    monkeypatch.setattr(runner, "is_installed", lambda: False)
    try:
        listed = asyncio.run(tools.list_labs())
    finally:
        store.delete(second.id)
    assert [entry["lab"] for entry in listed["labs"]].count("demo") == 1
    assert listed["default"] == "demo"


def test_list_workspace_files_skips_uninteresting_files(session):
    listed = asyncio.run(tools.list_workspace_files())
    names = " ".join(listed["files"])
    assert "topology.yml" in names and "notes.md" in names
    assert "secret.bin" not in names


def test_read_workspace_file_marks_content_untrusted(session):
    text = asyncio.run(tools.read_workspace_file("notes.md"))
    assert "lab notes" in text
    assert text.startswith("UNTRUSTED")


def test_read_workspace_file_refuses_to_escape_the_directory(session):
    with pytest.raises(tools.ToolError):
        asyncio.run(tools.read_workspace_file("../../etc/passwd"))


def test_write_workspace_file_creates_new_file(session):
    result = asyncio.run(tools.write_workspace_file("templates/bgp.j2", "router bgp 65000"))
    assert result["ok"] is True
    target = Path(session.topology_path).parent / "templates" / "bgp.j2"
    assert target.read_text() == "router bgp 65000"


def test_write_workspace_file_refuses_escaping_directory(session):
    with pytest.raises(tools.ToolError):
        asyncio.run(tools.write_workspace_file("../../etc/hack", "x"))


def test_propose_topology_edit_stages_without_writing(session):
    before = Path(session.topology_path).read_text()
    result = asyncio.run(tools.propose_topology_edit([{"type": "addNode", "id": "r3", "device": "frr"}], "scale out"))
    assert "+  r3:" in result["diff"]
    assert "approval" in result["status"]
    assert Path(session.topology_path).read_text() == before
    assert proposals.store.get(result["proposalId"]).status == "pending"


def test_propose_topology_edit_reports_bad_commands(session):
    with pytest.raises(tools.ToolError) as excinfo:
        asyncio.run(tools.propose_topology_edit([{"type": "nope"}], "x"))
    assert "nope" in str(excinfo.value)


def test_propose_fault_injection_describes_the_impairment(session):
    result = asyncio.run(tools.propose_fault_injection("r1", "eth1", delay_ms=50, loss_percent=5, rationale="lesson"))
    proposal = proposals.store.get(result["proposalId"])
    assert proposal.kind == "action"
    assert proposal.action["node"] == "r1"
    assert "50ms delay" in proposal.summary and "5% loss" in proposal.summary


def test_validate_topology_wraps_output_as_untrusted(session, monkeypatch):
    async def fake_validate(path):
        return runner.CommandResult(1, "FAIL: bgp session down", "")

    monkeypatch.setattr(runner, "validate", fake_validate)
    result = asyncio.run(tools.validate_topology())
    assert result["passed"] is False
    assert result["output"].startswith("UNTRUSTED")
    assert "bgp session down" in result["output"]


def test_validate_topology_explains_a_lab_without_tests(session, monkeypatch):
    async def fake_validate(path):
        return runner.CommandResult(1, "", "Fatal error in netlab: No validation tests defined for the current lab")

    monkeypatch.setattr(runner, "validate", fake_validate)
    assert asyncio.run(tools.validate_topology())["passed"] is None


def test_lab_status_handles_a_lab_that_is_not_running(session, monkeypatch):
    async def fake_status_for(path, max_age=4.0):
        raise runner.NetlabError(["netlab", "status"], 1, "no lab")

    monkeypatch.setattr(runner, "is_installed", lambda: True)
    monkeypatch.setattr(runner, "status_for", fake_status_for)
    assert asyncio.run(tools.get_lab_status()) == {"lab": "demo", "deployed": False}


def test_lab_status_is_concise_unless_asked(session, monkeypatch):
    async def fake_status_for(path, max_age=4.0):
        return {"log_line": "started", "log": ["a", "b"], "nodes": {"r1": {"status": "Up 2 hours"}}}

    monkeypatch.setattr(runner, "is_installed", lambda: True)
    monkeypatch.setattr(runner, "status_for", fake_status_for)
    concise = asyncio.run(tools.get_lab_status())
    assert concise["nodes"] == {"r1": "running"} and "log" not in concise
    assert asyncio.run(tools.get_lab_status(detail="full"))["log"] == ["a", "b"]


def test_run_show_command_rejects_writes_before_spawning(session, monkeypatch):
    spawned = []
    _running(monkeypatch)
    _spawn_answering(monkeypatch, {}, spawned)
    with pytest.raises(tools.ToolError):
        asyncio.run(tools.run_show_command("configure terminal", ["r1"]))
    assert spawned == []


def test_run_show_command_defaults_to_every_node_and_merges_identical_answers(session, monkeypatch):
    _running(monkeypatch, ("r1", "r2", "r3"))
    _spawn_answering(monkeypatch, {"r1": "same\n", "r2": "same\n", "r3": "different\n"})
    output = asyncio.run(tools.run_show_command("show version"))
    assert output.startswith("UNTRUSTED")
    assert "── r1, r2 ──\nsame" in output
    assert "── r3 ──\ndifferent" in output


def test_run_show_command_names_the_running_nodes_on_a_typo(session, monkeypatch):
    _running(monkeypatch)
    with pytest.raises(tools.ToolError) as excinfo:
        asyncio.run(tools.run_show_command("show version", ["r9"]))
    assert "r1, r2" in str(excinfo.value)


def test_run_show_command_on_an_undeployed_lab(session, monkeypatch):
    _running(monkeypatch, ())
    with pytest.raises(tools.ToolError) as excinfo:
        asyncio.run(tools.run_show_command("show version"))
    assert "not deployed" in str(excinfo.value)


def test_get_lab_is_a_compact_model(session, monkeypatch):
    model = {
        "provider": "clab",
        "nodes": {
            "r1": {
                "device": "frr",
                "mgmt": {"ipv4": "192.168.121.101"},
                "loopback": {"ipv4": "10.0.0.1/32"},
                "interfaces": [
                    {"ifname": "eth1", "ipv4": "10.1.0.1/30", "neighbors": [{"node": "r2", "ifname": "eth1"}]}
                ],
                "_node_config": {"huge": "x" * 5000},
            }
        },
        "links": [
            {
                "interfaces": [
                    {"node": "r1", "ifname": "eth1", "ipv4": "10.1.0.1/30"},
                    {"node": "r2", "ifname": "eth1", "ipv4": "10.1.0.2/30"},
                ],
                "prefix": {"ipv4": "10.1.0.0/30"},
            }
        ],
    }

    async def fake_create(path, **kwargs):
        return {"snapshot": model}

    monkeypatch.setattr(runner, "create", fake_create)
    _running(monkeypatch, ("r1",))
    lab = asyncio.run(tools.get_lab())
    assert lab["nodes"]["r1"] == {
        "device": "frr",
        "mgmt": "192.168.121.101",
        "loopback": "10.0.0.1/32",
        "state": "running",
    }
    assert lab["links"] == ["r1:eth1 10.1.0.1/30 — r2:eth1 10.1.0.2/30 (10.1.0.0/30)"]
    assert "huge" not in json.dumps(lab)
    full = asyncio.run(tools.get_lab(detail="full"))
    assert full["nodes"]["r1"]["interfaces"] == [{"ifname": "eth1", "ip": "10.1.0.1/30", "to": "r2:eth1"}]


def test_teaching_document_round_trip(session):
    asyncio.run(
        tools.create_teaching_document("OSPF basics", [{"caption": "Look at the adjacencies", "note": "step one"}])
    )
    document = asyncio.run(tools.get_teaching_document())
    assert document["title"] == "OSPF basics"
    assert document["steps"][0]["id"] == "step-1"


def test_selection_context(session):
    tools.set_selection(session.id, ["r1", "r2"])
    assert asyncio.run(tools.get_selection_context()) == {"lab": "demo", "selected": ["r1", "r2"]}


def test_large_output_is_capped(session, monkeypatch):
    monkeypatch.setattr(tools, "MAX_FILE_BYTES", 20)
    Path(session.topology_path).write_text("x" * 500)
    result = asyncio.run(tools.get_topology_yaml())
    assert "truncated" in result["yaml"]
    assert len(result["yaml"]) < 250
    assert json.dumps(result)  # still JSON-able for the transport


# ------------------------------------------------------------------ reference
_REPO = [
    "docs/module/bgp.md",
    "docs/labs/clab.md",
    "docs/labs/libvirt.md",
    "docs/images/diagram.png",
    "tests/integration/ospf/01-areas.yml",
    "tests/integration/ospf/topology-defaults.yml",
    "tests/integration/evpn/01-vxlan.yml",
    "tests/integration/wait_times.yml",
    "tests/topology/input/bgp.yml",
]


def test_netlab_show_passes_only_valid_filters(monkeypatch):
    calls = []

    async def fake_run(args, cwd=None):
        calls.append(args)
        return runner.CommandResult(0, "frr:\n  bgp: true\n", "")

    monkeypatch.setattr(runner, "run_command", fake_run)
    out = asyncio.run(tools.netlab_show("module-support", device="frr", module="bgp"))
    assert out.startswith("frr:")
    assert calls == [["show", "module-support", "--format", "yaml", "--device", "frr", "--module", "bgp"]]
    with pytest.raises(tools.ToolError, match="does not filter by provider"):
        asyncio.run(tools.netlab_show("modules", provider="clab"))


def test_netlab_show_error_reads_as_message(monkeypatch):
    async def fake_run(args, cwd=None):
        return runner.CommandResult(1, "", "Fatal error in netlab: Unknown device foo\n")

    monkeypatch.setattr(runner, "run_command", fake_run)
    with pytest.raises(tools.ToolError, match="Unknown device foo"):
        asyncio.run(tools.netlab_show("devices", device="foo"))


def test_read_netlab_docs_lists_and_reads_pages(monkeypatch):
    from services.netlab import docs

    fetched = []
    monkeypatch.setattr(docs, "repo_paths", lambda: _REPO)
    monkeypatch.setattr(docs, "fetch_doc", lambda page: fetched.append(page) or "# BGP")
    assert asyncio.run(tools.read_netlab_docs(search="LIBVIRT")) == {"pages": ["labs/libvirt.md"]}
    assert asyncio.run(tools.read_netlab_docs())["pages"] == ["module/bgp.md", "labs/clab.md", "labs/libvirt.md"]
    assert asyncio.run(tools.read_netlab_docs(page="docs/module/bgp")) == {"page": "module/bgp.md", "markdown": "# BGP"}
    assert fetched == ["module/bgp.md"]


def test_netlab_examples_groups_by_feature_and_skips_harness_files(monkeypatch):
    from services.netlab import docs

    monkeypatch.setattr(docs, "repo_paths", lambda: _REPO)
    monkeypatch.setattr(docs, "fetch_repo_file", lambda path: f"# {path}")
    assert asyncio.run(tools.netlab_examples())["examples"] == {"ospf": ["01-areas.yml"], "evpn": ["01-vxlan.yml"]}
    assert asyncio.run(tools.netlab_examples(search="evpn"))["examples"] == {"evpn": ["01-vxlan.yml"]}
    one = asyncio.run(tools.netlab_examples(path="ospf/01-areas.yml"))
    assert one == {"path": "ospf/01-areas.yml", "yaml": "# tests/integration/ospf/01-areas.yml"}


def test_reference_tools_say_when_offline(monkeypatch):
    from services.netlab import docs

    monkeypatch.setattr(docs, "repo_paths", lambda: None)
    monkeypatch.setattr(docs, "netsim_version", lambda: "26.05")
    with pytest.raises(tools.ToolError, match=r"netlab 26\.05"):
        asyncio.run(tools.netlab_examples())
