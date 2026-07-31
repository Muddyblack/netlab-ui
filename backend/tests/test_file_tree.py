"""Tests for the file explorer tree + file read/write endpoints."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from services.model import serialize


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


def test_tree_lists_sources_and_flags_generated(client, workspace):
    (workspace / "topo.yml").write_text("name: t\n")
    (workspace / "notes.md").write_text("# notes\n")
    (workspace / "clab.yml").write_text("name: t\n")
    (workspace / "hosts.yml").write_text("{}\n")
    (workspace / "ansible.cfg").write_text("[defaults]\n")
    (workspace / "topo.netlab-ui.json").write_text("{}\n")
    (workspace / "topo.yml.annotations.json").write_text("{}\n")
    (workspace / "group_vars").mkdir()
    (workspace / "configs").mkdir()
    (workspace / ".hidden").write_text("x")

    res = client.get("/api/lab/files/tree", params={"path": str(workspace)})
    assert res.status_code == 200
    entries = {e["name"]: e for e in res.json()["entries"]}

    assert ".hidden" not in entries
    assert entries["topo.yml"]["generated"] is False
    assert entries["notes.md"]["generated"] is False
    assert entries["configs"]["kind"] == "dir"
    assert entries["configs"]["generated"] is False
    for name in (
        "clab.yml",
        "hosts.yml",
        "ansible.cfg",
        "topo.netlab-ui.json",
        "topo.yml.annotations.json",
        "group_vars",
    ):
        assert entries[name]["generated"] is True, name

    # Directories sort before files
    names = [e["name"] for e in res.json()["entries"]]
    assert names.index("configs") < names.index("ansible.cfg")


def test_tree_rejects_paths_outside_workspaces(client, workspace):
    res = client.get("/api/lab/files/tree", params={"path": "/etc"})
    assert res.status_code == 403


def test_file_read_write_roundtrip(client, workspace):
    target = workspace / "topo.yml"
    target.write_text("name: before\n")

    res = client.get("/api/runtime/file-explorer/file", params={"path": str(target)})
    assert res.status_code == 200
    assert res.json()["content"] == "name: before\n"

    res = client.put(
        "/api/runtime/file-explorer/file",
        json={"path": str(target), "content": "name: after\n"},
    )
    assert res.status_code == 200
    assert target.read_text() == "name: after\n"


def test_file_endpoints_reject_outside_workspace(client, workspace):
    res = client.get("/api/runtime/file-explorer/file", params={"path": "/etc/passwd"})
    assert res.status_code == 403
    res = client.put(
        "/api/runtime/file-explorer/file",
        json={"path": "/etc/evil", "content": "x"},
    )
    assert res.status_code == 403


def test_clone_rejects_parent_directory_destination(client, workspace, monkeypatch):
    monkeypatch.setattr("app.lab.files.shutil.which", lambda _name: "/usr/bin/git")

    res = client.post("/api/lab/clone", json={"repoUrl": "https://example.test/.."})

    assert res.status_code == 400
    assert workspace.is_dir()


def test_new_lab_scaffold_is_transformable(client, workspace):
    """A scaffolded lab must survive `netlab create` as soon as the first node is
    dropped on the canvas. Canvas drops may leave `device` unset, and netlab
    aborts the whole transform when no default device exists — which silently
    downgrades the canvas to the model-derived projection."""
    resp = client.post("/api/lab/new", json={"name": "scaffold-check"})
    assert resp.status_code == 200

    text = Path(resp.json()["path"]).read_text()
    topo = serialize.from_yaml(text)
    assert topo.defaults.get("device"), f"scaffold has no default device:\n{text}"

    # A device-less node (what a canvas drop produces) must inherit the default.
    assert "device:" not in text.split("nodes:")[1]


@pytest.mark.parametrize("name", ["../escape", "/etc/passwd", "..", "sub/lab", "a" * 200])
def test_new_lab_keeps_the_file_inside_the_workspace(client, workspace, name):
    """Whatever the name, the created file lands directly in the workspace."""
    resp = client.post("/api/lab/new", json={"name": name})
    if resp.status_code == 200:
        assert Path(resp.json()["path"]).parent == workspace.resolve()
    else:
        assert resp.status_code == 400

    assert not (workspace.parent / "escape.yml").exists()


def test_session_rejects_a_topology_outside_every_workspace(client, workspace, tmp_path):
    outside = tmp_path / "elsewhere" / "lab.yml"
    outside.parent.mkdir()
    outside.write_text("name: lab\n")

    resp = client.post("/api/topology/sessions", json={"topologyPath": str(outside)})

    assert resp.status_code == 403
