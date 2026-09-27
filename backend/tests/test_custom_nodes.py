from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def session(tmp_path, monkeypatch, client) -> str:
    ws = tmp_path / "labs"
    (ws / "lab").mkdir(parents=True)
    monkeypatch.setenv("NETLAB_WORKSPACE", str(ws))
    monkeypatch.setenv("NETLAB_WORKSPACE_CONFIG", str(tmp_path / "ws.json"))
    topo = ws / "lab" / "topology.yml"
    topo.write_text("name: lab\ndefaults:\n  device: eos\nnodes:\nlinks:\n")
    return client.post("/api/topology/sessions", json={"topologyPath": str(topo)}).json()["sessionId"]


def test_fresh_lab_offers_starter_templates(client, session):
    """Without any template clab-ui's Add Node / Shift+click silently do nothing."""
    body = client.get(f"/api/topology/custom-nodes?sessionId={session}").json()
    by_name = {t["name"]: t for t in body["customNodes"]}
    assert body["defaultNode"] == "router"
    assert by_name["router"]["kind"] == "eos"  # the lab's default device
    assert by_name["host"]["kind"] == "linux"


def test_own_template_replaces_the_starters(client, session, tmp_path):
    client.post(f"/api/topology/custom-nodes?sessionId={session}", json={"name": "leaf", "kind": "eos"})
    body = client.get(f"/api/topology/custom-nodes?sessionId={session}").json()
    assert [t["name"] for t in body["customNodes"]] == ["leaf"]
    # Starters are served, never written to the sidecar.
    sidecar = Path(tmp_path / "labs" / "lab" / "topology.netlab-ui.json").read_text()
    assert '"router"' not in sidecar
