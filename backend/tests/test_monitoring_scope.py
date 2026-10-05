"""Choosing which nodes monitoring covers: saved selectors, previews, and applying a change to a running stack."""

import asyncio
import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services import monitoring
from services.netlab import runner

FIXTURE = Path(__file__).resolve().parents[2] / "monitoring" / "tests" / "fixtures" / "lab3-transformed.yml"


@pytest.fixture
def transformed(monkeypatch):
    """netlab's transform of a 3-router FRR lab plus a host, with the routers in a group."""
    topology = yaml.safe_load(FIXTURE.read_text())
    topology["groups"] = {"routers": {"members": ["r1", "r2", "r3"]}}

    async def fake_create(_path, isolated=False):
        return {"snapshot": topology}

    monkeypatch.setattr(runner, "create", fake_create)
    return topology


def lab(tmp_path, monkeypatch, body="plugin: [monitoring]\n"):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    path = tmp_path / "topology.yml"
    path.write_text(f"name: lab3\n{body}nodes: [r1, r2, r3, h1]\n")
    return path, store.create(str(path)).id


def states(scope):
    return {node["name"]: node["state"] for node in scope["universe"]}


# ---------------------------------------------------------------- saved settings


def test_the_selection_is_saved_and_read_back_without_leaving_empty_keys():
    attrs = {"plugin": ["monitoring"]}
    assert monitoring.scope_settings(attrs) == {"nodes": [], "light": [], "seed": 0}
    monitoring.set_scope(attrs, ["leaf*", "group:pod* | first 2"], ["spine*"], 7)
    assert attrs["monitoring"] == {"nodes": ["leaf*", "group:pod* | first 2"], "light": ["spine*"], "seed": 7}
    assert monitoring.scope_settings(attrs) == {
        "nodes": ["leaf*", "group:pod* | first 2"],
        "light": ["spine*"],
        "seed": 7,
    }
    monitoring.set_scope(attrs, [], [], 0)
    assert "monitoring" not in attrs
    # settings next to it stay, and netlab's dotted spelling is understood and migrated
    attrs = {"monitoring": {"placement": "node"}, "monitoring.nodes": "r1"}
    assert monitoring.scope_settings(attrs)["nodes"] == ["r1"]
    monitoring.set_scope(attrs, ["r2"], [], 0)
    assert attrs == {"monitoring": {"placement": "node", "nodes": ["r2"]}}


def test_describe_scope_gives_every_node_its_state(transformed):
    described = monitoring.describe_scope(transformed, ["routers | first 2", "!r1"], [], 0)
    assert (described["total"], described["monitored"], described["host"]) == (4, 1, 0)
    assert states(described) == {"r1": "off", "r2": "full", "r3": "off", "h1": "off"}
    described = monitoring.describe_scope(transformed, [], ["r1", "h1"], 0)
    assert states(described) == {"r1": "host", "r2": "full", "r3": "full", "h1": "host"}
    assert described["host"] == 2
    one = next(node for node in described["universe"] if node["name"] == "r1")
    assert one["groups"] == ["routers"] and one["device"] == "frr" and one["provider"] == "clab"
    bad = monitoring.describe_scope(transformed, ["re:("], ["nothing"], 0)
    assert "bad regular expression" in bad["errors"][0] and "matches no monitored node" in bad["warnings"][0]


# ---------------------------------------------------------------- the API


def test_the_api_reads_previews_and_saves_a_selection(tmp_path, monkeypatch, transformed):
    path, sid = lab(tmp_path, monkeypatch)
    client = TestClient(app)
    first = client.get("/api/lab/monitoring/scope", params={"sessionId": sid}).json()
    assert first["nodes"] == [] and first["monitored"] == 4 and first["canApply"] is False

    preview = client.post(
        "/api/lab/monitoring/scope/preview", json={"sessionId": sid, "nodes": ["routers"], "light": ["r3"]}
    ).json()
    assert states(preview) == {"r1": "full", "r2": "full", "r3": "host", "h1": "off"}
    assert "monitoring" not in path.read_text().replace("plugin: [monitoring]", "")  # a preview saves nothing

    saved = client.put(
        "/api/lab/monitoring/scope",
        json={"sessionId": sid, "nodes": ["routers"], "light": ["r3"], "seed": 4, "apply": False},
    )
    assert saved.status_code == 200
    on_disk = yaml.safe_load(path.read_text())
    assert on_disk["monitoring"] == {"nodes": ["routers"], "light": ["r3"], "seed": 4}
    again = client.get("/api/lab/monitoring/scope", params={"sessionId": sid}).json()
    assert (again["nodes"], again["light"], again["seed"], again["monitored"], again["host"]) == (
        ["routers"],
        ["r3"],
        4,
        3,
        1,
    )
    # clearing the selection removes the keys again
    client.put("/api/lab/monitoring/scope", json={"sessionId": sid, "apply": False})
    assert "monitoring" not in yaml.safe_load(path.read_text())


def test_a_bad_selection_is_refused_and_nothing_is_saved(tmp_path, monkeypatch, transformed):
    path, sid = lab(tmp_path, monkeypatch)
    client = TestClient(app)
    before = path.read_text()
    res = client.put("/api/lab/monitoring/scope", json={"sessionId": sid, "nodes": ["leaf* | first 0"]})
    assert res.status_code == 422 and "at least 1" in res.json()["detail"]
    assert client.put("/api/lab/monitoring/scope", json={"sessionId": sid, "nodes": ["re:("]}).status_code == 422
    assert path.read_text() == before
    # a selector that merely matches nothing is a warning, not a refusal
    ok = client.put("/api/lab/monitoring/scope", json={"sessionId": sid, "nodes": ["nope*", "r1"], "apply": False})
    assert ok.status_code == 200 and "matches no node" in ok.json()["warnings"][0]


def test_choosing_nodes_needs_monitoring_to_be_on(tmp_path, monkeypatch, transformed):
    _path, sid = lab(tmp_path, monkeypatch, body="")
    res = TestClient(app).put("/api/lab/monitoring/scope", json={"sessionId": sid, "nodes": ["r1"]})
    assert res.status_code == 409 and "Turn monitoring on" in res.json()["detail"]


def test_a_topology_netlab_cannot_transform_is_a_clear_error(tmp_path, monkeypatch):
    _path, sid = lab(tmp_path, monkeypatch)

    async def failing(_path, isolated=False):
        raise runner.NetlabError(["netlab", "create"], 1, "Fatal error in plugin: Aborting")

    monkeypatch.setattr(runner, "create", failing)
    res = TestClient(app).get("/api/lab/monitoring/scope", params={"sessionId": sid})
    assert res.status_code == 409 and "could not transform" in res.json()["detail"]


def test_the_state_says_how_much_of_the_lab_is_covered(tmp_path, monkeypatch):
    path, sid = lab(tmp_path, monkeypatch)
    plan = path.parent / "monitoring" / "plan.json"
    plan.parent.mkdir()
    plan.write_text(json.dumps({"scope": {"total": 12, "monitored": 5, "light": 2}, "nodes": {}}))
    state = TestClient(app).get("/api/lab/monitoring", params={"sessionId": sid}).json()
    assert (state["nodesTotal"], state["nodesMonitored"], state["nodesHostOnly"]) == (12, 5, 2)
    assert monitoring.scope_counts(tmp_path / "nowhere") == {"total": 0, "monitored": 0, "host": 0}  # no plan yet


# ---------------------------------------------------------------- applying to a running stack


class FakeProcess:
    def __init__(self, code=0, output=b"started\n"):
        self.returncode, self._output = code, output

    async def communicate(self):
        return self._output, None


def running_lab(tmp_path, monkeypatch, process):
    lab_dir = tmp_path / "lab"
    (lab_dir / "monitoring").mkdir(parents=True)
    (lab_dir / "monitoring" / "plan.json").write_text(json.dumps({"nodes": {"r1": {"methods": ["host", "frr"]}}}))
    (lab_dir / "monitoring" / "stack.json").write_text(json.dumps({"containers": {"collector": "lab3_mon_collector"}}))
    started = []

    async def fake_exec(*argv, **_kwargs):
        started.append(argv)
        return process

    async def always_running(_lab):
        return True

    monkeypatch.setattr(monitoring.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(monitoring, "stack_running", always_running)
    return lab_dir, started


def test_applying_renders_the_files_again_and_restarts_the_stack(tmp_path, monkeypatch, transformed):
    lab_dir, started = running_lab(tmp_path, monkeypatch, FakeProcess())
    transformed["monitoring"].update({"nodes": ["r1", "r2"], "light": ["r2"]})
    attrs = {"monitoring": {"nodes": ["r1", "r2"]}}
    applied, notes = asyncio.run(monitoring.apply_scope(lab_dir, str(tmp_path / "topology.yml"), attrs))
    assert applied and notes[0].startswith("Applied")
    plan = json.loads((lab_dir / "monitoring" / "plan.json").read_text())
    assert sorted(plan["nodes"]) == ["r1", "r2"] and plan["nodes"]["r2"]["detail"] == "host"
    assert plan["scope"] == {"monitored": 2, "light": 1, "total": 4}
    assert "lab3_mon_collector" in (lab_dir / "monitoring" / "up.sh").read_text()
    assert started == [("bash", str(lab_dir / "monitoring" / "up.sh"))]
    assert (lab_dir / "monitoring" / "up.sh").stat().st_mode & 0o111  # still runnable


def test_a_failed_restart_says_why(tmp_path, monkeypatch, transformed):
    lab_dir, _ = running_lab(
        tmp_path, monkeypatch, FakeProcess(1, b"monitoring: port 3000 (grafana) is already in use by another program\n")
    )
    with pytest.raises(RuntimeError, match=r"port 3000 \(grafana\)"):
        asyncio.run(monitoring.apply_scope(lab_dir, str(tmp_path / "topology.yml"), {}))


def test_nothing_is_restarted_when_the_stack_is_not_running_or_is_made_of_lab_nodes(tmp_path, monkeypatch, transformed):
    lab_dir, started = running_lab(tmp_path, monkeypatch, FakeProcess())

    async def stopped(_lab):
        return False

    monkeypatch.setattr(monitoring, "stack_running", stopped)
    applied, notes = asyncio.run(monitoring.apply_scope(lab_dir, "t.yml", {}))
    assert not applied and "next deployed" in notes[0]
    monkeypatch.undo()
    applied, notes = asyncio.run(monitoring.apply_scope(lab_dir, "t.yml", {"monitoring": {"placement": "node"}}))
    assert not applied and "lab nodes" in notes[0] and started == []
