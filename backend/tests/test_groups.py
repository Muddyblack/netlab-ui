from pathlib import Path

import pytest
from fastapi import HTTPException

from app.contract.router.groups import GroupPut, delete_group, save_group
from app.sessions.store import store
from services.model import serialize


def session_for(tmp_path: Path, yaml: str):
    path = tmp_path / "lab.yml"
    path.write_text(yaml)
    return path, store.create(str(path))


def test_group_rejects_unknown_members(tmp_path: Path):
    _, session = session_for(tmp_path, "name: lab\nnodes: [r1]\n")

    with pytest.raises(HTTPException, match="unknown group members"):
        save_group(session.id, GroupPut(name="edge", members=["missing"]))


def test_group_rejects_indirect_nested_cycle(tmp_path: Path):
    _, session = session_for(
        tmp_path,
        "name: lab\nnodes: [r1]\ngroups:\n  edge:\n    members: [r1]\n  all:\n    members: [edge]\n",
    )

    with pytest.raises(HTTPException, match="cannot contain themselves"):
        save_group(session.id, GroupPut(name="edge", members=["all"]))


def test_deleting_nested_group_removes_dangling_references(tmp_path: Path):
    path, session = session_for(
        tmp_path,
        "name: lab\nnodes: [r1]\ngroups:\n  edge:\n    members: [r1]\n  all:\n    members: [edge]\n",
    )

    delete_group(session.id, "edge")

    topology = serialize.from_yaml(path.read_text())
    assert topology.group("edge") is None
    assert topology.group("all").members == []
