"""Proposal previewing and the approve/reject flow.

The assistant's only write path runs through here, so these cover the safety
properties: previews never touch the real file, an approved edit lands as one
undoable step, and a diff computed against a stale revision is refused.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services.assistant import proposals

TOPOLOGY = """# demo lab
name: demo
nodes:
  r1:
    device: frr
  r2:
    device: frr
links:
- r1-r2
"""


@pytest.fixture
def session(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text(TOPOLOGY)
    created = store.create(str(path))
    yield created
    store.delete(created.id)
    proposals.store.clear()


@pytest.fixture
def client():
    try:
        from app.assistant.router import router as assistant_router
        app.include_router(assistant_router)
    except ImportError:
        pytest.skip("assistant dependencies (mcp) not installed")
    return TestClient(app)


def test_preview_does_not_touch_the_real_file(session):
    before = Path(session.topology_path).read_text()
    _, diff = proposals.preview_edit(session.topology_path, [{"type": "addNode", "id": "r3", "device": "frr"}])
    assert "+  r3:" in diff
    assert Path(session.topology_path).read_text() == before


def test_set_yaml_content_preserves_comments(session):
    edited = TOPOLOGY.replace("  r2:\n    device: frr\n", "  r2:\n    device: eos\n")
    _, diff = proposals.preview_edit(session.topology_path, [{"type": "setYamlContent", "content": edited}])
    # A minimal diff: the comment and everything else stays put.
    assert "# demo lab" not in diff
    assert "-    device: frr" in diff
    assert "+    device: eos" in diff


def test_no_op_commands_are_rejected(session):
    with pytest.raises(ValueError):
        proposals.create_edit(
            session_id=session.id,
            topology_path=session.topology_path,
            base_revision=session.revision,
            commands_list=[{"type": "setYamlContent", "content": TOPOLOGY}],
            rationale="nothing",
        )


def test_apply_writes_the_file_and_is_undoable(session, client):
    proposal = proposals.create_edit(
        session_id=session.id,
        topology_path=session.topology_path,
        base_revision=session.revision,
        commands_list=[
            {"type": "addNode", "id": "r3", "device": "frr"},
            {"type": "addLink", "source": "r1", "target": "r3"},
        ],
        rationale="scale out",
    )
    revision_before = session.revision

    response = client.post(f"/api/assistant/proposals/{proposal.id}/apply")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["proposal"]["status"] == "applied"

    text = Path(session.topology_path).read_text()
    assert "r3" in text

    # One history entry for the whole proposal, not one per command.
    assert session.host.can_undo
    session.host.apply_command({"type": "undo"})
    assert "r3" not in Path(session.topology_path).read_text()
    assert session.revision > revision_before


def test_apply_is_refused_when_the_topology_moved(session, client):
    proposal = proposals.create_edit(
        session_id=session.id,
        topology_path=session.topology_path,
        base_revision=session.revision,
        commands_list=[{"type": "addNode", "id": "r3", "device": "frr"}],
        rationale="scale out",
    )
    # Someone edits the topology after the diff was shown.
    session.host.apply_command({"type": "addNode", "id": "r9", "device": "frr"})

    response = client.post(f"/api/assistant/proposals/{proposal.id}/apply")
    assert response.status_code == 409
    assert proposals.store.get(proposal.id).status == "stale"


def test_apply_twice_is_refused(session, client):
    proposal = proposals.create_edit(
        session_id=session.id,
        topology_path=session.topology_path,
        base_revision=session.revision,
        commands_list=[{"type": "addNode", "id": "r3", "device": "frr"}],
        rationale="scale out",
    )
    assert client.post(f"/api/assistant/proposals/{proposal.id}/apply").status_code == 200
    assert client.post(f"/api/assistant/proposals/{proposal.id}/apply").status_code == 409


def test_reject_leaves_the_file_alone(session, client):
    proposal = proposals.create_edit(
        session_id=session.id,
        topology_path=session.topology_path,
        base_revision=session.revision,
        commands_list=[{"type": "addNode", "id": "r3", "device": "frr"}],
        rationale="scale out",
    )
    response = client.post(f"/api/assistant/proposals/{proposal.id}/reject")
    assert response.status_code == 200
    assert response.json()["proposal"]["status"] == "rejected"
    assert "r3" not in Path(session.topology_path).read_text()


def test_list_proposals_is_scoped_to_the_session(session, client):
    proposals.create_edit(
        session_id=session.id,
        topology_path=session.topology_path,
        base_revision=session.revision,
        commands_list=[{"type": "addNode", "id": "r3", "device": "frr"}],
        rationale="scale out",
    )
    listed = client.get("/api/assistant/proposals", params={"sessionId": session.id}).json()["proposals"]
    assert len(listed) == 1
    assert client.get("/api/assistant/proposals", params={"sessionId": "other"}).json()["proposals"] == []


def test_store_is_capped():
    store_ = proposals.ProposalStore(limit=2)
    for index in range(3):
        store_.add(
            proposals.Proposal(id=str(index), session_id="s", kind="edit", base_revision=1, rationale="", summary="")
        )
    assert store_.get("0") is None
    assert store_.get("2") is not None
