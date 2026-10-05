from __future__ import annotations

import pytest

from services.netlab import node_configs


def _lab(tmp_path):
    (tmp_path / "node_files" / "r1").mkdir(parents=True)
    for name in ("bgp", "daemons", "initial", "ospf", "zzz.cfg"):
        (tmp_path / "node_files" / "r1" / name).write_text(name)
    (tmp_path / "host_vars" / "r1").mkdir(parents=True)
    (tmp_path / "host_vars" / "r1" / "topology.json").write_text("{}")
    return tmp_path


def test_lists_generated_files_in_reading_order(tmp_path):
    files = node_configs.list_files(_lab(tmp_path), "r1")
    assert [(f["group"], f["name"]) for f in files] == [
        ("Generated configuration", "initial"),
        ("Generated configuration", "daemons"),
        ("Generated configuration", "ospf"),
        ("Generated configuration", "bgp"),
        ("Generated configuration", "zzz.cfg"),
        ("Node data", "topology.json"),
    ]


def test_empty_before_create(tmp_path):
    assert node_configs.list_files(tmp_path, "r1") == []


@pytest.mark.parametrize("node", ["..", "../x", "a/b", "", ".hidden"])
def test_rejects_traversal(tmp_path, node):
    with pytest.raises(ValueError):
        node_configs.list_files(tmp_path, node)
