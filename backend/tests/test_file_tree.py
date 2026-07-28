"""Tests for the file explorer tree + file read/write endpoints."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


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
    for name in ("clab.yml", "hosts.yml", "ansible.cfg", "topo.netlab-ui.json", "group_vars"):
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
