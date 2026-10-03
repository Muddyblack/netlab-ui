"""A netlab.lock left by an interrupted `netlab up` must not lock the lab for good."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.lab import lifecycle
from app.main import app
from app.sessions.store import store
from services.netlab import runner


@pytest.fixture
def lab(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("NETLAB_WORKSPACE_CONFIG", str(tmp_path / "ws.json"))
    (tmp_path / "topology.yml").write_text("name: t\nnodes: [r1]\n")
    return tmp_path


def registry(monkeypatch, instances):
    async def fake(max_age=0):
        return instances

    monkeypatch.setattr(runner, "status_cached", fake)


def check(lab):
    return asyncio.run(lifecycle.interrupted_start(str(lab / "topology.yml")))


def test_no_lock_means_nothing_to_recover(lab, monkeypatch):
    registry(monkeypatch, {})
    assert check(lab) is None


def test_a_lock_the_registry_does_not_know_is_stale(lab, monkeypatch):
    (lab / "netlab.lock").write_text("netlab lock file, do not remove")
    registry(monkeypatch, {})
    assert check(lab) == "unlock"  # no snapshot to resume from
    (lab / "netlab.snapshot.pickle").write_bytes(b"x")
    assert check(lab) == "continue"


def test_a_start_that_never_finished_is_resumed(lab, monkeypatch):
    (lab / "netlab.lock").write_text("lock")
    (lab / "netlab.snapshot.pickle").write_bytes(b"x")
    registry(monkeypatch, {"default": {"dir": str(lab), "status": "starting provider libvirt"}})
    assert check(lab) == "continue"


def test_a_lab_that_is_running_is_left_to_netlab(lab, monkeypatch):
    (lab / "netlab.lock").write_text("lock")
    (lab / "netlab.snapshot.pickle").write_bytes(b"x")
    registry(monkeypatch, {"default": {"dir": str(lab), "status": "Running"}})
    assert check(lab) is None
    # ... and so is one in another directory's name
    registry(monkeypatch, {"other": {"dir": str(lab / "elsewhere"), "status": "Running"}})
    assert check(lab) == "continue"


def run_up(monkeypatch, lab, **body):
    """POST the lifecycle stream for 'up' with the netlab command faked; returns (steps, frames)."""
    seen = []

    async def fake_sequence(steps):
        seen.extend(steps)
        yield "stderr", "boom"
        yield "exit", "1"

    monkeypatch.setattr(lifecycle, "_run_sequence", fake_sequence)

    async def no_quota(*_args):
        return None

    monkeypatch.setattr(lifecycle, "_enforce_quota", no_quota)
    sid = store.create(str(lab / "topology.yml")).id
    res = TestClient(app).post("/api/lab/lifecycle/stream", json={"sessionId": sid, "action": "up", **body})
    assert res.status_code == 200
    frames = [json.loads(line[6:]) for line in res.text.splitlines() if line.startswith("data: ")]
    return seen, frames


def test_up_resumes_an_interrupted_start_with_snapshot(lab, monkeypatch):
    (lab / "netlab.lock").write_text("lock")
    (lab / "netlab.snapshot.pickle").write_bytes(b"x")
    registry(monkeypatch, {})
    steps, frames = run_up(monkeypatch, lab)
    assert steps == [(["up", "--snapshot"], lab)]
    lines = [f["line"] for f in frames if "line" in f]
    assert "interrupted" in lines[0] and "netlab up --snapshot" in lines[0]


def test_up_removes_a_lock_it_cannot_resume_from(lab, monkeypatch):
    (lab / "netlab.lock").write_text("lock")
    registry(monkeypatch, {})
    steps, frames = run_up(monkeypatch, lab)
    assert not (lab / "netlab.lock").exists()
    assert steps[0][0] == ["up", "topology.yml"]  # a normal start
    assert any("Removed the netlab.lock" in f.get("line", "") for f in frames)


def test_up_is_untouched_without_a_lock_or_for_a_parallel_instance(lab, monkeypatch):
    registry(monkeypatch, {})
    steps, _ = run_up(monkeypatch, lab)
    assert steps[0][0] == ["up", "topology.yml"]
    (lab / "netlab.lock").write_text("lock")
    steps, _ = run_up(monkeypatch, lab, multilabId=2)
    assert (lab / "netlab.lock").exists() and "--snapshot" not in steps[0][0]
