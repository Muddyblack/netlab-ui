"""Test that commands with nested payload structure are handled correctly."""

from app.contract import commands


def test_delete_node_with_nested_payload(tmp_path):
    """Commands from clab-ui have nested payload: { command: "deleteNode", payload: { id: "r1" } }"""
    topo_file = tmp_path / "test.yml"
    topo_file.write_text("name: test\nnodes:\n  r1:\n  r2:\nlinks:\n  - r1-r2\n")

    cmd = {"command": "deleteNode", "payload": {"id": "r1"}}
    structural = commands.apply(str(topo_file), cmd)

    assert structural is True
    yaml_content = topo_file.read_text()
    assert "r1" not in yaml_content
    assert "r2" in yaml_content
    assert "r1-r2" not in yaml_content  # link should be removed


def test_delete_link_with_nested_payload(tmp_path):
    """Test deleteLink command with nested payload."""
    topo_file = tmp_path / "test.yml"
    topo_file.write_text("name: test\nnodes:\n  r1:\n  r2:\n  r3:\nlinks:\n  - r1-r2\n  - r2-r3\n")

    cmd = {"command": "deleteLink", "payload": {"source": "r1", "target": "r2"}}
    structural = commands.apply(str(topo_file), cmd)

    assert structural is True
    yaml_content = topo_file.read_text()
    assert "r1" in yaml_content
    assert "r2" in yaml_content
    assert "r1-r2" not in yaml_content
    assert "r2-r3" in yaml_content  # other link should remain


def test_save_positions_with_memberships_batch(tmp_path):
    """Test savePositionsWithMemberships command (alias for savePositions)."""
    topo_file = tmp_path / "test.yml"
    topo_file.write_text("name: test\nnodes:\n  r1:\n  r2:\n")

    cmd = {
        "command": "savePositionsWithMemberships",
        "payload": [
            {"id": "r1", "position": {"x": 100, "y": 200}},
            {"id": "r2", "position": {"x": 300, "y": 400}},
        ],
    }
    structural = commands.apply(str(topo_file), cmd)

    assert structural is False  # layout only
    # Positions are saved to annotations, not YAML


def test_save_positions_and_annotations_payload(tmp_path):
    """savePositionsAndAnnotations carries an object payload, not a raw list."""
    topo_file = tmp_path / "test.yml"
    topo_file.write_text("name: test\nnodes:\n  r1:\n")

    cmd = {
        "command": "savePositionsAndAnnotations",
        "payload": {
            "positions": [
                {"id": "r1", "position": {"x": 120, "y": 240}},
            ],
            "annotations": {
                "freeTextAnnotations": [{"id": "note-1", "text": "hello"}],
                "groupStyleAnnotations": [{"id": "group-1", "label": "Group 1"}],
            },
        },
    }

    structural = commands.apply(str(topo_file), cmd)

    assert structural is False

    from services import annotations as ann_store

    ann = ann_store.load(topo_file)
    assert ann_store.get_node_annotation(ann, "r1")["position"] == {"x": 120, "y": 240}
    assert ann["freeTextAnnotations"] == [{"id": "note-1", "text": "hello"}]
    assert ann["groupStyleAnnotations"] == [{"id": "group-1", "label": "Group 1"}]
