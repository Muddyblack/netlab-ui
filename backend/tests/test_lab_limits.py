import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services import lab_limits, owners
from services.netlab import runner


@pytest.fixture(autouse=True)
def registry(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_OWNERS_FILE", str(tmp_path / "owners.json"))
    for name in ("NETLAB_UI_LAB_HOURS", "NETLAB_UI_MAX_LABS_PER_USER", "NETLAB_UI_ADMINS"):
        monkeypatch.delenv(name, raising=False)


def _lab(tmp_path, name):
    lab = tmp_path / name
    lab.mkdir()
    (lab / "topology.yml").write_text("nodes: [r1]\n")
    return lab


def test_quota_counts_other_running_labs_of_the_same_user(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_MAX_LABS_PER_USER", "1")
    a, b = _lab(tmp_path, "a"), _lab(tmp_path, "b")
    owners.record(a, "alice")
    status = {"1": {"dir": str(a), "name": "a"}}
    lab_limits.check_quota("alice", status, a)  # redeploying her own lab is fine
    lab_limits.check_quota("bob", status, b)
    with pytest.raises(lab_limits.QuotaExceeded, match="limit is 1"):
        lab_limits.check_quota("alice", status, b)
    monkeypatch.setenv("NETLAB_UI_ADMINS", "alice")
    lab_limits.check_quota("alice", status, b)


def test_lease_is_recorded_extended_and_reaped(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_LAB_HOURS", "2")
    lab = _lab(tmp_path, "a")
    owners.record(lab, None, lab_limits.lease_expiry())
    annotated = owners.annotate({"x": {"dir": str(lab)}})["x"]
    assert "expiresAt" in annotated and "owner" not in annotated
    assert lab_limits.expired() == []

    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat(timespec="seconds")
    owners.update(lab, expiresAt=past)
    assert lab_limits.expired() == [str(lab.resolve())]
    calls = []

    async def run_command(args, cwd=None):
        calls.append((args, cwd))
        return runner.CommandResult(code=0, stdout="", stderr="")

    monkeypatch.setattr(runner, "run_command", run_command)
    assert asyncio.run(lab_limits.reap_once()) == [str(lab.resolve())]
    assert calls == [(["down"], lab.resolve())]
    assert owners.entries() == {}

    owners.record(lab, "alice", past)
    lab_limits.extend(lab)
    assert lab_limits.expired() == []


def test_extend_endpoint_and_limits(tmp_path, monkeypatch):
    lab = _lab(tmp_path, "a")
    sid = store.create(str(lab / "topology.yml")).id
    client = TestClient(app)
    assert client.post("/api/lab/lease/extend", json={"sessionId": sid}).status_code == 400
    monkeypatch.setenv("NETLAB_UI_LAB_HOURS", "1.5")
    assert client.post("/api/lab/lease/extend", json={"sessionId": sid}).status_code == 404
    owners.record(lab, "alice", lab_limits.lease_expiry())
    assert client.post("/api/lab/lease/extend", json={"sessionId": sid}).json()["expiresAt"]
    assert client.get("/api/lab/limits").json()["labHours"] == 1.5


def test_deploy_beyond_quota_is_refused_before_netlab_runs(tmp_path, monkeypatch):
    from fastapi import HTTPException

    from app.lab import lifecycle

    monkeypatch.setenv("NETLAB_UI_MAX_LABS_PER_USER", "1")
    a, b = _lab(tmp_path, "a"), _lab(tmp_path, "b")
    owners.record(a, "alice")

    async def status_cached(max_age=0):
        return {"1": {"dir": str(a), "name": "a"}}

    monkeypatch.setattr(runner, "status_cached", status_cached)
    with pytest.raises(HTTPException) as refused:
        asyncio.run(lifecycle._enforce_quota("alice", str(b / "topology.yml")))
    assert refused.value.status_code == 429
    asyncio.run(lifecycle._enforce_quota("bob", str(b / "topology.yml")))
