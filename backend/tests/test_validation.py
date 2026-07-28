import asyncio
from pathlib import Path

from app.lab import lifecycle
from services.netlab import validation
from services.netlab.runner import NetlabError


def test_parse_maps_node_link_and_global_issues():
    issues = validation.parse(
        "ERROR node r1 has an invalid bgp.as\nWARNING link r1-r2 has no prefix\nFATAL malformed defaults\n",
        ["r1", "r2"],
        [("r1", "r2")],
    )

    assert [(issue.entity_type, issue.entity_id) for issue in issues] == [
        ("node", "r1"),
        ("link", "r1--r2"),
        ("topology", None),
    ]


def test_cached_results_are_invalidated_when_yaml_changes(tmp_path: Path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: {r1: {}}\n")
    validation.store(topology, "ERROR node r1 failed", ["r1"], [])
    assert validation.current(topology)

    topology.write_text("nodes: {r2: {}}\n")
    assert validation.current(topology) == []


def test_store_failure_preserves_unclassified_schema_error(tmp_path: Path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: {}\n")

    issues = validation.store_failure(topology, "IncorrectValue in nodes.r1.device")

    assert len(issues) == 1
    assert issues[0].entity_type == "topology"
    assert issues[0].severity == "error"
    assert "IncorrectValue" in issues[0].message


def test_preflight_returns_entity_mapped_transform_warnings(tmp_path: Path, monkeypatch):
    topology = tmp_path / "lab.yml"
    topology.write_text("name: lab\nnodes: [r1]\n")

    async def fake_create(_path):
        return {"stdout": "WARNING node r1 uses a default value\n", "stderr": ""}

    monkeypatch.setattr(lifecycle.common, "session_path", lambda _session_id: str(topology))
    monkeypatch.setattr(lifecycle.runner, "create", fake_create)

    result = asyncio.run(lifecycle.lab_preflight(lifecycle.LabAction(sessionId="test")))

    assert result["code"] == 0
    assert result["issues"][0]["entityType"] == "node"
    assert result["issues"][0]["entityId"] == "r1"


def test_preflight_never_hides_unclassified_transform_failure(tmp_path: Path, monkeypatch):
    topology = tmp_path / "lab.yml"
    topology.write_text("name: lab\nnodes: [r1]\n")

    async def fake_create(_path):
        raise NetlabError(["netlab", "create"], 2, "IncorrectValue in nodes.r1.device")

    monkeypatch.setattr(lifecycle.common, "session_path", lambda _session_id: str(topology))
    monkeypatch.setattr(lifecycle.runner, "create", fake_create)

    result = asyncio.run(lifecycle.lab_preflight(lifecycle.LabAction(sessionId="test")))

    assert result["code"] == 2
    assert result["issues"] == [
        {
            "severity": "error",
            "message": "IncorrectValue in nodes.r1.device",
            "entityType": "topology",
            "entityId": None,
        }
    ]
