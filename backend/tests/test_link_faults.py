from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services.netlab import runner


def _session(tmp_path, monkeypatch):
    path = tmp_path / "topology.yml"
    path.write_text("name: t\nnodes: [r1, sw]\n")

    async def status_for(_path):
        return {"nodes": {"r1": {"provider": "clab", "provider_name": "clab-t-r1"}, "sw": {"provider": "libvirt"}}}

    monkeypatch.setattr(runner, "status_for", status_for)
    return store.create(str(path)).id


def test_link_state_runs_ip_link_in_the_nodes_container(tmp_path, monkeypatch):
    sid = _session(tmp_path, monkeypatch)
    calls = []

    async def set_state(container, interface, up, preferred_runtime=""):
        calls.append((container, interface, up))
        return runner.CommandResult(code=0, stdout="", stderr="")

    monkeypatch.setattr(runner, "set_interface_state", set_state)
    res = TestClient(app).post(
        "/api/lab/link-state", json={"sessionId": sid, "node": "r1", "interface": "eth1", "up": False}
    )
    assert res.status_code == 200 and res.json()["code"] == 0
    assert calls == [("clab-t-r1", "eth1", False)]


def test_link_state_rejects_odd_interfaces_and_non_container_nodes(tmp_path, monkeypatch):
    sid = _session(tmp_path, monkeypatch)
    client = TestClient(app)
    bad = client.post(
        "/api/lab/link-state", json={"sessionId": sid, "node": "r1", "interface": "eth1; reboot", "up": False}
    )
    assert bad.status_code == 422
    vm = client.post("/api/lab/link-state", json={"sessionId": sid, "node": "sw", "interface": "eth1", "up": False})
    assert vm.status_code == 409
