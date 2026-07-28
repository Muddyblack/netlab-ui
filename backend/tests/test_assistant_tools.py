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


def test_unknown_session_is_an_actionable_error():
    with pytest.raises(tools.ToolError) as excinfo:
        asyncio.run(tools.get_topology_yaml("nope"))
    assert "list_sessions" in str(excinfo.value)


def test_list_sessions_reports_open_topologies(session):
    listed = asyncio.run(tools.list_sessions())
    assert any(entry["sessionId"] == session.id and entry["name"] == "topology.yml" for entry in listed)


def test_get_topology_yaml_returns_the_source(session):
    result = asyncio.run(tools.get_topology_yaml(session.id))
    assert result["yaml"] == TOPOLOGY
    assert result["revision"] == session.revision


def test_list_workspace_files_skips_uninteresting_files(session):
    names = {entry["name"] for entry in asyncio.run(tools.list_workspace_files(session.id))}
    assert {"topology.yml", "notes.md"} <= names
    assert "secret.bin" not in names


def test_read_workspace_file_marks_content_untrusted(session):
    text = asyncio.run(tools.read_workspace_file(session.id, "notes.md"))
    assert "lab notes" in text
    assert text.startswith("UNTRUSTED")


def test_read_workspace_file_refuses_to_escape_the_directory(session):
    with pytest.raises(tools.ToolError):
        asyncio.run(tools.read_workspace_file(session.id, "../../etc/passwd"))


def test_write_workspace_file_creates_new_file(session):
    result = asyncio.run(tools.write_workspace_file(session.id, "templates/bgp.j2", "router bgp 65000"))
    assert result["ok"] is True
    target = Path(session.topology_path).parent / "templates" / "bgp.j2"
    assert target.exists()
    assert target.read_text() == "router bgp 65000"


def test_write_workspace_file_refuses_escaping_directory(session):
    with pytest.raises(tools.ToolError):
        asyncio.run(tools.write_workspace_file(session.id, "../../etc/hack", "x"))


def test_propose_topology_edit_stages_without_writing(session):
    before = Path(session.topology_path).read_text()
    result = asyncio.run(
        tools.propose_topology_edit(session.id, [{"type": "addNode", "id": "r3", "device": "frr"}], "scale out")
    )
    assert "+  r3:" in result["diff"]
    assert "approval" in result["status"]
    assert Path(session.topology_path).read_text() == before
    assert proposals.store.get(result["proposalId"]).status == "pending"


def test_propose_topology_edit_reports_bad_commands(session):
    with pytest.raises(tools.ToolError) as excinfo:
        asyncio.run(tools.propose_topology_edit(session.id, [{"type": "nope"}], "x"))
    assert "nope" in str(excinfo.value)


def test_propose_fault_injection_describes_the_impairment(session):
    result = asyncio.run(
        tools.propose_fault_injection(session.id, "r1", "eth1", delay_ms=50, loss_percent=5, rationale="lesson")
    )
    proposal = proposals.store.get(result["proposalId"])
    assert proposal.kind == "action"
    assert proposal.action["node"] == "r1"
    assert "50ms delay" in proposal.summary and "5% loss" in proposal.summary


def test_validate_topology_wraps_output_as_untrusted(session, monkeypatch):
    async def fake_validate(path):
        return runner.CommandResult(1, "FAIL: bgp session down", "")

    monkeypatch.setattr(runner, "validate", fake_validate)
    result = asyncio.run(tools.validate_topology(session.id))
    assert result["exitCode"] == 1
    assert result["output"].startswith("UNTRUSTED")
    assert "bgp session down" in result["output"]


def test_lab_status_handles_a_lab_that_is_not_running(session, monkeypatch):
    async def fake_status_for(path, max_age=4.0):
        raise runner.NetlabError(["netlab", "status"], 1, "no lab")

    monkeypatch.setattr(runner, "is_installed", lambda: True)
    monkeypatch.setattr(runner, "status_for", fake_status_for)
    result = asyncio.run(tools.get_lab_status(session.id))
    assert result["lab"] == {}
    assert "running" in result["note"]


def test_exec_on_node_rejects_writes_before_spawning(session, monkeypatch):
    spawned = []

    async def fake_spawn(args, cwd=None):
        spawned.append(args)
        raise AssertionError("should not spawn")

    monkeypatch.setattr(runner, "spawn_command", fake_spawn)
    with pytest.raises(tools.ToolError):
        asyncio.run(tools.exec_on_node(session.id, "r1", "configure terminal"))
    assert spawned == []


def test_exec_on_node_returns_untrusted_output(session, monkeypatch):
    class Done:
        returncode = 0
        pid = 1

        async def communicate(self):
            return b"10.0.0.0/8 via eth1\n", b""

    async def fake_spawn(args, cwd=None):
        assert args[:2] == ["exec", "r1"]
        return Done()

    monkeypatch.setattr(runner, "spawn_command", fake_spawn)
    output = asyncio.run(tools.exec_on_node(session.id, "r1", "show ip route"))
    assert output.startswith("UNTRUSTED")
    assert "10.0.0.0/8" in output


def test_teaching_document_round_trip(session):
    asyncio.run(
        tools.create_teaching_document(
            session.id, "OSPF basics", [{"caption": "Look at the adjacencies", "note": "step one"}]
        )
    )
    document = asyncio.run(tools.get_teaching_document(session.id))
    assert document["title"] == "OSPF basics"
    assert document["steps"][0]["id"] == "step-1"


def test_selection_context(session):
    from services.assistant import chat

    chat.manager.set_selection(session.id, ["r1", "r2"])
    assert asyncio.run(tools.get_selection_context(session.id)) == {"selection": ["r1", "r2"]}


def test_large_output_is_capped(session, monkeypatch):
    monkeypatch.setattr(tools, "MAX_FILE_BYTES", 20)
    big = "x" * 500
    Path(session.topology_path).write_text(big)
    result = asyncio.run(tools.get_topology_yaml(session.id))
    assert "truncated" in result["yaml"]
    assert len(result["yaml"]) < 200
    assert json.dumps(result)  # still JSON-able for the transport
