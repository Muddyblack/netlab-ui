"""Tests for the Image Manager kind->image reference catalog endpoint."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from netlab_ui.app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def workspace(tmp_path, monkeypatch) -> Path:
    ws = tmp_path / "labs"
    ws.mkdir()
    monkeypatch.setenv("NETLAB_WORKSPACE", str(ws))
    monkeypatch.setenv("NETLAB_WORKSPACE_CONFIG", str(tmp_path / "ws.json"))
    return ws


def _netlab_frr_kind() -> str:
    """clab.node.kind from the frr device file of the netlab the backend uses (the device name if unset)."""
    from ruamel.yaml import YAML

    from netlab_ui.services.netlab import location

    device = YAML().load((location.netsim_package_dir() / "devices" / "frr.yml").read_text(encoding="utf-8"))
    return str(((device.get("clab") or {}).get("node") or {}).get("kind") or "frr")


def test_kind_references_include_device_defaults(client, workspace):
    res = client.get("/api/lab/images/kind-references")
    assert res.status_code == 200
    refs = res.json()

    defaults = [r for r in refs if r["source"] == "topology-defaults"]
    assert defaults, "expected netsim device defaults in the catalog"
    frr = next((r for r in defaults if r["image"].startswith("quay.io/frrouting/frr")), None)
    assert frr is not None
    # The kind is whatever the installed netlab says: FRR ran as containerlab kind `linux` up to
    # netlab 26.10 and as kind `frr` from 26.11.
    assert frr["kind"] == _netlab_frr_kind()


def test_kind_references_include_topology_nodes(client, workspace):
    (workspace / "topo.yml").write_text(
        "name: t\nnodes:\n  r1:\n    device: frr\n  r2:\n    device: frr\n    image: custom/frr:1\n"
    )

    res = client.get("/api/lab/images/kind-references")
    assert res.status_code == 200
    node_refs = {r["nodeName"]: r for r in res.json() if r["source"] == "topology-node"}

    assert node_refs["r1"]["image"].startswith("quay.io/frrouting/frr")
    assert node_refs["r2"]["image"] == "custom/frr:1"
    assert node_refs["r1"]["path"] == str((workspace / "topo.yml").resolve())


def test_kind_references_resolve_topology_default_device(client, workspace):
    (workspace / "topo.yml").write_text("name: t\ndefaults:\n  device: frr\nnodes:\n  r1:\n")

    res = client.get("/api/lab/images/kind-references")
    node_refs = [r for r in res.json() if r["source"] == "topology-node"]
    assert any(r["nodeName"] == "r1" for r in node_refs)
