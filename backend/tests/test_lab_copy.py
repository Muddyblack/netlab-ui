import pytest
from fastapi.testclient import TestClient

from app.lab import lab_copy
from app.main import app


@pytest.fixture
def workspaces(tmp_path, monkeypatch):
    mine, shared = tmp_path / "mine", tmp_path / "shared"
    mine.mkdir()
    shared.mkdir()
    monkeypatch.setenv("NETLAB_WORKSPACE", str(mine))
    monkeypatch.setenv("NETLAB_WORKSPACE_CONFIG", str(tmp_path / "ws.json"))
    monkeypatch.setenv("NETLAB_UI_SHARED_WORKSPACE", str(shared))
    return mine, shared


def _own_dir_lab(root):
    lab = root / "bgp-lab"
    (lab / "node_files" / "r1").mkdir(parents=True)
    (lab / "templates").mkdir()
    (lab / "topology.yml").write_text("# my lab\nname: bgp-lab\nnodes: [r1]\n")
    (lab / "topology.netlab-ui.json").write_text("{}")
    (lab / "templates" / "extra.j2").write_text("x")
    for generated in ("clab.yml", "netlab.lock", "hosts.yml", "netlab.snapshot.pickle"):
        (lab / generated).write_text("generated")
    (lab / ".netlab-ui" / "configs").mkdir(parents=True)
    return lab


def test_fork_shared_lab_into_my_workspace(workspaces):
    mine, shared = workspaces
    lab = _own_dir_lab(shared)
    res = TestClient(app).post("/api/lab/copy", json={"topologyPath": str(lab / "topology.yml"), "name": "my-bgp"})
    assert res.status_code == 200, res.text
    copy = mine / "my-bgp"
    assert res.json()["path"] == str((copy / "topology.yml").resolve())
    assert (copy / "topology.yml").read_text() == "# my lab\nname: my-bgp\nnodes: [r1]\n"
    assert (copy / "topology.netlab-ui.json").exists() and (copy / "templates" / "extra.j2").exists()
    for generated in ("clab.yml", "netlab.lock", "hosts.yml", "netlab.snapshot.pickle", "node_files", ".netlab-ui"):
        assert not (copy / generated).exists(), generated


def test_publish_a_topology_that_shares_its_folder(workspaces):
    mine, shared = workspaces
    (mine / "a.yml").write_text("nodes: [r1]\n")
    (mine / "a.netlab-ui.json").write_text("{}")
    (mine / "b.yml").write_text("nodes: [x]\n")
    client = TestClient(app)
    res = client.post(
        "/api/lab/copy", json={"topologyPath": str(mine / "a.yml"), "name": "team-a", "targetWorkspace": str(shared)}
    )
    assert res.status_code == 200, res.text
    assert sorted(p.name for p in (shared / "team-a").iterdir()) == ["a.netlab-ui.json", "a.yml"]
    again = client.post(
        "/api/lab/copy", json={"topologyPath": str(mine / "a.yml"), "name": "team-a", "targetWorkspace": str(shared)}
    )
    assert again.status_code == 409


def test_copy_refuses_odd_names_and_foreign_paths(workspaces, tmp_path):
    mine, _shared = workspaces
    (mine / "a.yml").write_text("nodes: [r1]\n")
    client = TestClient(app)
    assert client.post("/api/lab/copy", json={"topologyPath": str(mine / "a.yml"), "name": "../x"}).status_code == 400
    outside = tmp_path / "elsewhere.yml"
    outside.write_text("nodes: []\n")
    assert client.post("/api/lab/copy", json={"topologyPath": str(outside), "name": "x"}).status_code == 403
    assert (
        client.post(
            "/api/lab/copy", json={"topologyPath": str(mine / "a.yml"), "name": "x", "targetWorkspace": "/tmp"}
        ).status_code
        == 400
    )


def test_rename_touches_only_the_top_level_name():
    text = "name: old\nnodes:\n  r1:\n    name: keep\n"
    assert lab_copy.rename_lab(text, "new") == "name: new\nnodes:\n  r1:\n    name: keep\n"
    assert lab_copy.rename_lab("nodes: [a]\n", "new") == "nodes: [a]\n"
