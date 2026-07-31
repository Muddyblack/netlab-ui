"""Tests for the workspace unit library: dotted-endpoint validation at save
time and canvas view-state (groups/icons) carried through save + instantiate."""

import json

import pytest

from services import units
from services.model import serialize


def _save(units_dir, name, nodes=(), links=(), includes=(), source=None):
    body = {
        "name": name,
        "nodes": [dict(n) for n in nodes],
        "links": [dict(link) for link in links],
        "includes": [dict(i) for i in includes],
        "module": [],
    }
    return units.save_unit(units_dir, body, source_topology=source)


def test_dotted_endpoint_valid_sibling_link(tmp_path):
    _save(tmp_path, "room", nodes=[{"name": "sw", "device": "ovs"}])
    # building wires room1.sw <-> room2.sw — both resolve, save succeeds.
    _save(
        tmp_path,
        "building",
        links=[{"endpoints": ["room1.sw", "room2.sw"]}],
        includes=[{"template": "room", "count": 2}],
    )


def test_dotted_endpoint_unknown_instance_rejected(tmp_path):
    _save(tmp_path, "room", nodes=[{"name": "sw", "device": "ovs"}])
    with pytest.raises(ValueError, match="room3"):
        _save(
            tmp_path,
            "building",
            links=[{"endpoints": ["room3.sw", "room1.sw"]}],
            includes=[{"template": "room", "count": 2}],
        )


def test_dotted_endpoint_unknown_node_rejected(tmp_path):
    _save(tmp_path, "room", nodes=[{"name": "sw", "device": "ovs"}])
    with pytest.raises(ValueError, match="nope"):
        _save(
            tmp_path,
            "building",
            links=[{"endpoints": ["room.nope", "room.sw"]}],
            includes=[{"template": "room", "count": 1}],
        )


def test_dotted_endpoint_count_one_uses_bare_name(tmp_path):
    _save(tmp_path, "room", nodes=[{"name": "sw", "device": "ovs"}])
    # count == 1 -> the instance is "room", not "room1".
    with pytest.raises(ValueError, match="room1"):
        _save(
            tmp_path,
            "building",
            links=[{"endpoints": ["room1.sw", "room1.sw"]}],
            includes=[{"template": "room", "count": 1}],
        )


def test_dotted_endpoint_nested_include(tmp_path):
    _save(tmp_path, "workstation", nodes=[{"name": "pc", "device": "linux"}])
    _save(tmp_path, "room", includes=[{"template": "workstation", "count": 2}])
    _save(
        tmp_path,
        "building",
        links=[{"endpoints": ["room1.workstation1.pc", "room2.workstation2.pc"]}],
        includes=[{"template": "room", "count": 2}],
    )
    with pytest.raises(ValueError, match="workstation3"):
        _save(
            tmp_path,
            "tower",
            links=[{"endpoints": ["room1.workstation3.pc", "room1.workstation1.pc"]}],
            includes=[{"template": "room", "count": 2}],
        )


def test_save_captures_group_styling_from_source_lab(tmp_path):
    lab = tmp_path / "lab.yml"
    lab.write_text("name: lab\n")
    sidecar = tmp_path / "lab.netlab-ui.json"
    sidecar.write_text(
        json.dumps(
            {
                "nodeAnnotations": [
                    {"id": "sw", "groupId": "group-1", "icon": "switch"},
                    {"id": "other", "groupId": "group-2", "icon": "router"},
                ],
                "groupStyleAnnotations": [
                    {"id": "group-1", "name": "Rack", "backgroundColor": "red", "position": {"x": 10, "y": 20}},
                    {"id": "group-2", "name": "Unrelated"},
                ],
            }
        )
    )
    units_dir = tmp_path / "units"
    _save(units_dir, "rack", nodes=[{"name": "sw", "device": "ovs", "x": 5, "y": 5}], source=lab)

    loaded = {u["name"]: u for u in units.list_units(units_dir)}["rack"]
    assert loaded["nodeAnnotations"] == [
        {"id": "sw", "groupId": "group-1", "icon": "switch", "position": {"x": 5, "y": 5}}
    ]
    assert [s["id"] for s in loaded["groupStyleAnnotations"]] == ["group-1"]
    assert loaded["icons"] == {"sw": "switch"}


def test_save_never_serializes_canvas_annotation_nodes_or_view_fields(tmp_path):
    path = _save(
        tmp_path,
        "clean",
        nodes=[
            {"name": "r1", "attrs": {"bgp": {"as": 65000}, "state": "running", "iconColor": "blue"}},
            {
                "name": "group-1",
                "attrs": {
                    "level": "1",
                    "width": 500,
                    "height": 320,
                    "backgroundColor": "rgba(100, 100, 255, 0.1)",
                    "borderColor": "#cccccc",
                    "zIndex": -1,
                },
            },
        ],
    )

    topology = serialize.from_yaml(path.read_text())
    assert [node.name for node in topology.nodes] == ["r1"]
    assert topology.node("r1").attrs == {"bgp": {"as": 65000}}
    assert "group-1" not in path.read_text()


def test_unit_usage_is_recorded_and_survives_an_edit(tmp_path):
    _save(tmp_path, "rack", nodes=[{"name": "sw", "device": "ovs"}])

    units.record_use(tmp_path, "rack")
    units.record_use(tmp_path, "rack")
    assert units.list_units(tmp_path)[0]["usageCount"] == 2

    _save(tmp_path, "rack", nodes=[{"name": "sw", "device": "ovs"}])
    assert units.list_units(tmp_path)[0]["usageCount"] == 2


def test_instance_annotations_prefix_and_translate(tmp_path):
    unit = {
        "name": "rack",
        "nodes": [{"name": "sw", "device": "ovs", "x": 100, "y": 200}],
        "links": [],
        "includes": [],
        "module": [],
        "nodeAnnotations": [{"id": "sw", "groupId": "group-1"}],
        "groupStyleAnnotations": [{"id": "group-1", "name": "Rack", "position": {"x": 90, "y": 190}}],
        "icons": {"sw": "switch"},
    }
    out = units.instance_annotations({"rack": unit}, "rack", 2, "rack", {"x": 1000, "y": 2000})

    by_id = {e["id"]: e for e in out["nodeAnnotations"]}
    assert set(by_id) == {"rack1_sw", "rack2_sw"}
    assert by_id["rack1_sw"]["position"] == {"x": 1000, "y": 2000}
    assert {nid: e["icon"] for nid, e in by_id.items()} == {"rack1_sw": "switch", "rack2_sw": "switch"}
    assert {nid: e["groupId"] for nid, e in by_id.items()} == {
        "rack1_sw": "rack1_group-1",
        "rack2_sw": "rack2_group-1",
    }
    styles = {s["id"]: s for s in out["groupStyleAnnotations"]}
    assert set(styles) == {"rack1_group-1", "rack2_group-1"}
    # Group box translated by the same offset as its nodes: node moved from
    # (100,200) to (1000,2000), so the box goes from (90,190) to (990,1990).
    assert styles["rack1_group-1"]["position"] == {"x": 990, "y": 1990}


def test_export_import_round_trips_topology_and_view_state(tmp_path):
    # A unit with an internal link + canvas view-state (group box + icon).
    units.save_unit(
        tmp_path,
        {
            "name": "rack",
            "nodes": [
                {"name": "sw1", "device": "ovs", "x": 10, "y": 20, "attrs": {}},
                {"name": "sw2", "device": "ovs", "x": 30, "y": 40, "attrs": {}},
            ],
            "links": [{"endpoints": ["sw1", "sw2"], "attrs": {}}],
            "module": ["ospf"],
        },
    )
    from services import annotations as ann_store

    path = units._unit_path(tmp_path, "rack")
    ann = ann_store.load(path)
    ann["groupStyleAnnotations"] = [{"id": "g1", "name": "Rack", "position": {"x": 5, "y": 5}}]
    ann_store.ensure_node_annotation(ann, "sw1")["icon"] = "switch"
    ann_store.save(path, ann)

    bundle = units.export_unit(tmp_path, "rack")
    assert bundle["kind"] == "netlab-unit"
    assert bundle["unit"]["name"] == "rack"

    # Import into a *fresh* workspace — full fidelity.
    dest = tmp_path / "other"
    dest.mkdir()
    name = units.import_unit(dest, bundle)
    assert name == "rack"
    imported = {u["name"]: u for u in units.list_units(dest)}["rack"]
    assert {n["name"] for n in imported["nodes"]} == {"sw1", "sw2"}
    assert imported["module"] == ["ospf"]
    assert imported["icons"] == {"sw1": "switch"}
    assert any(s["id"] == "g1" for s in imported["groupStyleAnnotations"])

    # Re-importing into the SAME workspace renames instead of clobbering.
    second = units.import_unit(dest, bundle)
    assert second == "rack-2"
    assert {u["name"] for u in units.list_units(dest)} == {"rack", "rack-2"}


def test_import_rejects_non_bundle(tmp_path):
    with pytest.raises(ValueError, match="bundle"):
        units.import_unit(tmp_path, {"kind": "something-else", "unit": {"name": "x"}})


@pytest.mark.parametrize("name", ["../escape", r"..\escape", ".", "..", "nested/name"])
def test_unit_path_rejects_traversal(tmp_path, name):
    with pytest.raises(ValueError, match="invalid unit"):
        units._unit_path(tmp_path, name)


def test_unit_path_rejects_symlink_escape(tmp_path):
    outside = tmp_path / "outside.yml"
    outside.write_text("name: outside\n")
    units_dir = tmp_path / "units"
    units_dir.mkdir()
    (units_dir / "escape.yml").symlink_to(outside)

    with pytest.raises(ValueError, match="invalid unit path"):
        units._unit_path(units_dir, "escape")


def test_unit_version_bumps_on_each_save(tmp_path):
    units_dir = tmp_path / "units"
    _save(units_dir, "rack", nodes=[{"name": "sw", "device": "ovs"}])
    assert units.unit_version(units_dir, "rack") == 1
    _save(units_dir, "rack", nodes=[{"name": "sw", "device": "ovs"}, {"name": "sw2", "device": "ovs"}])
    assert units.unit_version(units_dir, "rack") == 2
    listed = {u["name"]: u for u in units.list_units(units_dir)}["rack"]
    assert listed["version"] == 2


def test_instance_provenance_detects_outdated_and_orphaned(tmp_path):
    units_dir = tmp_path / "units"
    _save(units_dir, "rack", nodes=[{"name": "sw", "device": "ovs"}])  # v1
    lab = tmp_path / "lab.yml"
    lab.write_text("name: lab\nnodes: {}\n")

    units.record_provenance(lab, ["rack1"], "rack", 1)
    row = units.instance_provenance(lab, units_dir, {"rack1"})[0]
    assert row == {
        "instance": "rack1",
        "unit": "rack",
        "version": 1,
        "currentVersion": 1,
        "exists": True,
        "outdated": False,
        "orphaned": False,
    }

    # Editing the unit bumps it to v2 → the placed instance is now stale.
    _save(units_dir, "rack", nodes=[{"name": "sw", "device": "ovs"}, {"name": "sw2", "device": "ovs"}])
    row = units.instance_provenance(lab, units_dir, {"rack1"})[0]
    assert row["currentVersion"] == 2 and row["outdated"] is True

    # Instance removed from the topology → flagged as gone.
    assert units.instance_provenance(lab, units_dir, set())[0]["exists"] is False

    # Deleting the unit orphans the placed instance.
    units.delete_unit(units_dir, "rack")
    orphan = units.instance_provenance(lab, units_dir, {"rack1"})[0]
    assert orphan["orphaned"] is True and orphan["currentVersion"] is None


def test_bare_multi_instance_reference_is_accepted(tmp_path):
    # A "wp" with a `pc`, and a room wiring "each wp → sw" via the bare, count>1
    # reference `wp.pc`. This is the scaling-connection rule and must validate.
    _save(tmp_path, "wp", nodes=[{"name": "pc", "device": "linux"}])
    _save(
        tmp_path,
        "room",
        nodes=[{"name": "sw", "device": "ovs"}],
        links=[{"endpoints": ["wp.pc", "sw"]}],
        includes=[{"template": "wp", "count": 4}],
    )
    room = next(u for u in units.list_units(tmp_path) if u["name"] == "room")
    assert {"endpoints": ["wp.pc", "sw"], "attrs": {}} in room["links"]


def test_update_composition_preserves_canvas_owned_yaml_and_layout(tmp_path):
    from services import annotations as ann_store

    _save(tmp_path, "wp", nodes=[{"name": "pc", "device": "linux"}])
    path = _save(
        tmp_path,
        "room",
        nodes=[{"name": "sw", "device": "ovs", "x": 40, "y": 60}],
        links=[{"endpoints": ["sw", "sw"]}],  # placeholder internal link
    )
    yaml_before = path.read_text()

    units.update_unit_composition(
        tmp_path,
        "room",
        {
            "includes": [{"template": "wp", "count": 3}],
            "module": ["lag"],
            "ports": ["sw"],
            "links": [{"endpoints": ["wp.pc", "sw"]}],
        },
    )

    # The canvas-owned YAML (nodes + internal links) is untouched.
    assert path.read_text() == yaml_before
    ann = ann_store.load(path)
    assert ann_store.get_node_annotation(ann, "sw")["position"] == {"x": 40, "y": 60}  # layout preserved
    meta = ann["unit"]
    assert meta["includes"] == [{"template": "wp", "count": 3}]
    assert meta["module"] == ["lag"]
    assert meta["ports"] == ["sw"]
    assert {"endpoints": ["wp.pc", "sw"], "attrs": {}} in meta["externalLinks"]
    assert meta["version"] == 2  # bumped from the create at v1


def test_update_composition_filters_ports_to_own_nodes(tmp_path):
    _save(tmp_path, "room", nodes=[{"name": "sw", "device": "ovs"}])
    units.update_unit_composition(tmp_path, "room", {"ports": ["sw", "ghost"]})
    room = next(u for u in units.list_units(tmp_path) if u["name"] == "room")
    assert room["ports"] == ["sw"]


def test_update_composition_rejects_unknown_unit(tmp_path):
    with pytest.raises(ValueError, match="unknown unit"):
        units.update_unit_composition(tmp_path, "nope", {"includes": []})
