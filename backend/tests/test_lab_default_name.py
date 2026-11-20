"""A topology without ``name:`` is named after its directory, like netlab does, and saving keeps it unnamed."""

from pathlib import Path

import pytest

from netlab_ui.app.contract import commands
from netlab_ui.services.model.topology import default_lab_name


@pytest.mark.parametrize(
    ("directory", "expected"),
    [
        ("ospf", "ospf"),
        ("my-lab_2", "mylab2"),
        ("2024 bgp lab", "bgplab"),
        ("a-very-long-lab-name", "averylonglab"),
        ("123", "default"),
    ],
)
def test_default_name_follows_netlab(tmp_path, directory, expected):
    path = tmp_path / directory / "topology.yml"
    assert default_lab_name(str(path)) == expected


def test_default_name_matches_installed_netlab(tmp_path):
    topology = pytest.importorskip("netsim.augment.topology")
    path = tmp_path / "My-Lab_2026x" / "topology.yml"
    assert default_lab_name(str(path)) == topology.name_from_path({"input": [str(path)]})[:12]


def test_unnamed_topology_stays_unnamed_on_save(tmp_path):
    path = tmp_path / "ospf" / "topology.yml"
    path.parent.mkdir()
    path.write_text("provider: clab\nnodes: [r1, r2]\nlinks: [r1-r2]\n")
    topo = commands.load_topology(str(path))
    assert topo.name == "ospf" and topo.name_implicit
    commands.save_topology(str(path), topo)
    assert "name:" not in path.read_text()


def test_named_topology_keeps_its_name(tmp_path):
    path = tmp_path / "ospf" / "topology.yml"
    path.parent.mkdir()
    path.write_text("name: core\nnodes: [r1]\n")
    topo = commands.load_topology(str(path))
    assert topo.name == "core" and not topo.name_implicit
    commands.save_topology(str(path), topo)
    assert "name: core" in path.read_text()


def test_renaming_writes_the_name(tmp_path):
    path = tmp_path / "ospf" / "topology.yml"
    path.parent.mkdir()
    path.write_text("nodes: [r1]\n")
    commands._set_lab_settings(str(path), {"name": "edge"})
    assert "name: edge" in Path(path).read_text()
