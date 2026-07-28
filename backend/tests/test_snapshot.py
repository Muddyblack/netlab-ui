import asyncio

from app.contract import snapshot
from services.model import serialize
from services.netlab import validation


def test_snapshot_runtime_fields_do_not_leak_into_yaml(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert snap["nodes"][0]["data"]["label"] == "r1"
    assert snap["nodes"][0]["data"]["state"] == "undeployed"
    assert topo.node("r1").attrs == {}
    assert "label:" not in snap["yamlContent"]
    assert "state:" not in snap["yamlContent"]
    assert "role:" not in snap["yamlContent"]


def test_snapshot_edges_include_endpoint_data(tmp_path, monkeypatch):
    """Edges must include sourceEndpoint and targetEndpoint for clab-ui rendering.
    When interface names are unknown (pre-deployment), we use empty strings to avoid
    displaying misleading labels."""
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n  r2:\n  r3:\nlinks:\n  - r1-r2\n  - r2-r3\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert len(snap["edges"]) == 2

    # Check first edge
    edge0 = snap["edges"][0]
    assert edge0["id"] == "e0"
    assert edge0["source"] == "r1"
    assert edge0["target"] == "r2"
    assert "data" in edge0
    assert "sourceEndpoint" in edge0["data"]
    assert "targetEndpoint" in edge0["data"]
    # Empty strings when interface names are not yet known
    assert edge0["data"]["sourceEndpoint"] == ""
    assert edge0["data"]["targetEndpoint"] == ""

    # Check second edge
    edge1 = snap["edges"][1]
    assert edge1["data"]["sourceEndpoint"] == ""
    assert edge1["data"]["targetEndpoint"] == ""


def test_snapshot_edges_carry_topology_edge_type(tmp_path, monkeypatch):
    """Every edge must declare type "topology-edge" so React Flow uses clab-ui's
    custom edge renderer. Without it, links fall back to React Flow's thin 1px
    default edge and visibly flip to thin lines on the next snapshot refresh."""
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n  r2:\n  r3:\nlinks:\n  - r1-r2\n  - r2-r3\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert snap["edges"], "expected edges to be present"
    assert all(edge["type"] == "topology-edge" for edge in snap["edges"])


def test_snapshot_projects_validation_issues_onto_nodes_and_links(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes: [r1, r2]\nlinks: [r1-r2]\n")
    topology = serialize.from_yaml(topology_path.read_text())
    validation.store(
        topology_path,
        "ERROR node r1 has an invalid bgp.as\nWARNING link r1-r2 has no prefix\n",
        ["r1", "r2"],
        [("r1", "r2")],
    )

    result = asyncio.run(snapshot.build(str(topology_path), topology, 0))

    r1 = next(node for node in result["nodes"] if node["id"] == "r1")
    assert r1["data"]["iconColor"] == "#d32f2f"
    assert r1["data"]["extraData"]["validationIssues"][0]["entityType"] == "node"
    assert result["edges"][0]["data"]["linkStatus"] == "down"
    assert result["edges"][0]["data"]["extraData"]["validationIssues"][0]["entityType"] == "link"
