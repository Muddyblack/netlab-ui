import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.lab import broadcast
from app.main import app
from app.sessions.store import store
from services.netlab import runner

TOPOLOGY = """\
name: t
defaults.device: frr
nodes: [r1, r2, h1]
groups:
  core: [r1, r2]
  edge:
    members: [core, h1]
"""


@pytest.fixture
def session(tmp_path, monkeypatch):
    path = tmp_path / "topology.yml"
    path.write_text(TOPOLOGY)

    async def status_for(_path):
        return {"nodes": {"r1": {"status": "running", "provider": "clab"}, "r2": {"status": "exited"}}}

    monkeypatch.setattr(runner, "status_for", status_for)
    return store.create(str(path)).id


def test_expand_targets_resolves_groups_nested_groups_and_all():
    nodes = ["r1", "r2", "h1"]
    groups = {"core": ["r1", "r2"], "edge": ["core", "h1"]}
    assert broadcast.expand_targets(["h1", "core"], nodes, groups) == ["r1", "r2", "h1"]
    assert broadcast.expand_targets(["edge"], nodes, groups) == nodes
    assert broadcast.expand_targets(["all"], nodes, groups) == nodes
    with pytest.raises(HTTPException):
        broadcast.expand_targets(["nope"], nodes, groups)


def test_expand_targets_survives_group_cycles():
    assert broadcast.expand_targets(["a"], ["r1"], {"a": ["b"], "b": ["a", "r1"]}) == ["r1"]


def test_exec_args_per_mode():
    args = broadcast.exec_args("r1", 'ip r | grep "a b"', "shell", "clab")
    assert " ".join(args[3:]).startswith('( ip r | grep "a b" ); printf')
    assert broadcast.exec_args("r1", "uname -a", "shell", "libvirt") == ["exec", "-q", "r1", "uname", "-a"]
    assert broadcast.exec_args("r1", "ip route", "show", "clab") == ["connect", "-q", "r1", "--show", "ip", "route"]


def test_targets_report_running_state_and_groups(session):
    body = TestClient(app).get("/api/lab/exec/targets", params={"sessionId": session}).json()
    assert [(n["name"], n["device"], n["running"]) for n in body["nodes"]] == [
        ("r1", "frr", True),
        ("r2", "frr", False),
        ("h1", "frr", False),
    ]
    assert body["groups"] == {"core": ["r1", "r2"], "edge": ["core", "h1"]}


def test_exec_stream_fans_out_and_reports_each_node(session, monkeypatch):
    calls = []

    class FakeProc:
        pid = 0
        returncode = 0

        def __init__(self, args):
            self.args = args

        async def communicate(self):
            trailer = f"\n{broadcast.EXIT_MARKER}3\n" if self.args[2] == "r1" else ""
            return f"out:{self.args[2]}{trailer}".encode(), b""

    async def spawn(args, cwd=None):
        calls.append(args)
        return FakeProc(args)

    monkeypatch.setattr(runner, "spawn_command", spawn)
    monkeypatch.setattr(runner, "is_installed", lambda: True)
    res = TestClient(app).post(
        "/api/lab/exec/stream", json={"sessionId": session, "nodes": ["core"], "command": "uptime"}
    )
    frames = [json.loads(line[6:]) for line in res.text.splitlines() if line.startswith("data: ")]
    assert frames[0] == {"targets": ["r1", "r2"]}
    results = {f["result"]["node"]: f["result"] for f in frames if "result" in f}
    assert results["r1"]["output"] == "out:r1"
    assert results["r1"]["exitCode"] == 3 and results["r1"]["failed"] is True
    assert results["r2"]["exitCode"] is None and results["r2"]["failed"] is False
    assert frames[-1] == {"done": True}
    # r1 is a clab node → sh -c; r2's provider is unknown → plain argv.
    assert any(call[:5] == ["exec", "-q", "r1", "(", "uptime"] for call in calls)
    assert ["exec", "-q", "r2", "uptime"] in calls


def test_scripts_round_trip_next_to_topology(session, tmp_path):
    client = TestClient(app)
    assert client.get("/api/lab/exec/scripts", params={"sessionId": session}).json() == {"scripts": []}
    script = {"name": "check", "steps": [{"command": "show ip bgp", "mode": "show", "nodes": ["core"]}]}
    saved = client.put("/api/lab/exec/scripts", json={"sessionId": session, "scripts": [script]}).json()
    assert saved["scripts"][0]["name"] == "check"
    assert (tmp_path / "topology.netlab-ui-scripts.json").exists()
    assert client.get("/api/lab/exec/scripts", params={"sessionId": session}).json() == saved
    client.put("/api/lab/exec/scripts", json={"sessionId": session, "scripts": []})
    assert not (tmp_path / "topology.netlab-ui-scripts.json").exists()


def test_exit_marker_and_cli_error_detection():
    assert broadcast.split_exit_marker(f"hello\n\n{broadcast.EXIT_MARKER}1\n") == ("hello\n", 1)
    assert broadcast.split_exit_marker("no trailer") == ("no trailer", None)
    assert broadcast.looks_like_cli_error("\n% Unknown command: show bogus\n")
    assert broadcast.looks_like_cli_error("Error: Path not found")
    assert not broadcast.looks_like_cli_error("Codes: K - kernel route")
