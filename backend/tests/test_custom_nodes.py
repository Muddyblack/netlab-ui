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


def _lab_with_nodes(tmp_path, client) -> str:
    topo = tmp_path / "labs" / "lab" / "topology.yml"
    topo.write_text(
        "name: lab\ndefaults:\n  device: eos\nnodes:\n  r1:\n  r2:\n    device: frr\n  h1:\n    device: linux\nlinks: [r1-r2, r2-h1]\n" #noqa: E501
    )
    return client.post("/api/topology/sessions", json={"topologyPath": str(topo)}).json()["sessionId"]


def test_existing_lab_offers_the_devices_it_uses(client, session, tmp_path):
    lab = _lab_with_nodes(tmp_path, client)
    body = client.get(f"/api/topology/custom-nodes?sessionId={lab}").json()
    assert {t["kind"] for t in body["customNodes"]} == {"eos", "frr", "linux"}


def test_removed_device_template_stays_removed(client, session, tmp_path):
    lab = _lab_with_nodes(tmp_path, client)
    body = client.delete(f"/api/topology/custom-nodes/frr?sessionId={lab}").json()
    assert {t["kind"] for t in body["customNodes"]} == {"eos", "linux"}


def test_import_merges_templates_by_name(client, session):
    url = f"/api/topology/custom-nodes/import?sessionId={session}"
    client.post(f"/api/topology/custom-nodes?sessionId={session}", json={"name": "leaf", "kind": "eos"})
    body = client.post(
        url, json={"templates": [{"name": "leaf", "kind": "frr"}, {"name": "spine", "kind": "nxos"}]}
    ).json()
    assert {t["name"]: t["kind"] for t in body["customNodes"]} == {"leaf": "frr", "spine": "nxos"}
    assert client.post(url, json={"templates": [{"name": "x"}]}).status_code == 400
