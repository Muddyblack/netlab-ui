"""Test batch command handling."""

from app.contract import commands


def test_batch_command_executes_multiple_commands(tmp_path):
    """Batch command should execute multiple sub-commands in sequence."""
    topo_file = tmp_path / "test.yml"
    topo_file.write_text("name: test\nnodes:\n  r1:\n  r2:\nlinks:\n  - r1-r2\n")

    # Batch command with savePositions and setNodeGroupMemberships
    cmd = {
        "command": "batch",
        "payload": {
            "commands": [
                {
                    "command": "savePositions",
                    "payload": [
                        {"id": "r1", "position": {"x": 100, "y": 200}},
                        {"id": "r2", "position": {"x": 300, "y": 400}},
                    ],
                },
                {"command": "setNodeGroupMemberships", "payload": []},
            ]
        },
    }

    structural = commands.apply(str(topo_file), cmd)

    # savePositions is layout-only, setNodeGroupMemberships is also non-structural
    assert structural is False


def test_batch_command_with_structural_changes(tmp_path):
    """Batch command returns True if any sub-command is structural."""
    topo_file = tmp_path / "test.yml"
    topo_file.write_text("name: test\nnodes:\n  r1:\n  r2:\nlinks:\n  - r1-r2\n")

    # Batch with both layout and structural commands
    cmd = {
        "command": "batch",
        "payload": {
            "commands": [
                {"command": "savePositions", "payload": [{"id": "r1", "position": {"x": 100, "y": 200}}]},
                {"command": "addNode", "payload": {"id": "r3"}},
            ]
        },
    }

    structural = commands.apply(str(topo_file), cmd)

    # Should be structural because addNode is structural
    assert structural is True

    yaml_content = topo_file.read_text()
    assert "r3" in yaml_content
