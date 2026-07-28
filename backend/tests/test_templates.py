"""Tests for template instantiation: duplicate-a-room and nested house-of-rooms."""

import pytest

from services.model import serialize
from services.model.templates import instantiate
from services.model.topology import IncludeRef, Link, Node, Template, Topology


def _room_template() -> Template:
    # A "room": one switch + two hosts, hosts cabled to the switch.
    return Template(
        name="room",
        nodes=[Node("sw", device="ovs"), Node("h1", device="linux"), Node("h2", device="linux")],
        links=[Link(["sw", "h1"]), Link(["sw", "h2"])],
        module=["lag"],
    )


def test_instantiate_room_three_times():
    topo = Topology(name="lab", templates=[_room_template()])
    instantiate(topo, "room", 3)

    # 3 rooms x 3 nodes = 9 nodes, each prefixed room1_/room2_/room3_.
    assert len(topo.nodes) == 9
    assert {n.name for n in topo.nodes} >= {"room1_sw", "room2_h1", "room3_h2"}

    # 3 rooms x 2 links = 6 links, rewired to prefixed names.
    assert len(topo.links) == 6
    assert ["room2_sw", "room2_h1"] in [link.endpoints for link in topo.links]

    # One group per room, members are the room's own nodes, module carried over.
    groups = {g.name: g for g in topo.groups}
    assert set(groups) == {"room1", "room2", "room3"}
    assert sorted(groups["room1"].members) == ["room1_h1", "room1_h2", "room1_sw"]
    assert groups["room1"].module == ["lag"]


def test_single_instance_uses_bare_prefix():
    topo = Topology(name="lab", templates=[_room_template()])
    instantiate(topo, "room", 1, prefix="lobby")
    assert "lobby" in {g.name for g in topo.groups}
    assert "lobby_sw" in {n.name for n in topo.nodes}


def test_overlong_generated_identifier_is_rejected_before_mutation():
    topo = Topology(
        name="lab",
        templates=[Template(name="KISS", nodes=[Node("POASD1_cl_b")])],
    )

    with pytest.raises(ValueError, match="at most 16"):
        instantiate(topo, "KISS", 1, prefix="KISS1")

    assert topo.nodes == []
    assert topo.groups == []


def test_shortened_prefix_accepts_sixteen_character_identifier():
    topo = Topology(
        name="lab",
        templates=[Template(name="KISS", nodes=[Node("POASD1_cl_b")])],
    )

    instantiate(topo, "KISS", 1, prefix="KIS1")

    assert [node.name for node in topo.nodes] == ["KIS1_POASD1_cl_b"]


def test_nested_house_of_rooms():
    # A "house" includes the room template twice; expanding the house once yields
    # a house group whose MEMBERS are the two room *groups* (nested by name).
    topo = Topology(
        name="lab",
        templates=[
            _room_template(),
            Template(name="house", includes=[IncludeRef(template="room", count=2)]),
        ],
    )
    instantiate(topo, "house", 1)

    groups = {g.name: g for g in topo.groups}
    assert "house" in groups
    # Nested membership: the house lists room group names, not raw nodes.
    assert sorted(groups["house"].members) == ["house_room1", "house_room2"]
    assert "house_room1" in groups
    assert "house_room1_sw" in {n.name for n in topo.nodes}


def test_expansion_serializes_to_valid_netlab_shape():
    topo = Topology(name="lab", templates=[_room_template()])
    instantiate(topo, "room", 2)
    data = serialize.to_dict(topo)
    assert set(data["groups"]) == {"room1", "room2"}
    assert "room1_sw" in data["nodes"]
    # No coordinates leaked into the topology (check real coordinate carriers,
    # not naive substrings — "linux" contains an "x").
    out = serialize.to_yaml(topo)
    assert "graph-pos" not in out and "position:" not in out


def test_external_connection_mapping():
    # A room template that has a link to an external node "core" (which is not in its nodes list)
    room_with_external = Template(
        name="room_ext",
        nodes=[Node("sw", device="ovs")],
        links=[Link(["sw", "core"])],
    )
    topo = Topology(
        name="lab",
        nodes=[Node("core", device="eos")],
        templates=[room_with_external],
    )

    # Instantiate room_ext twice, mapping "core" to the topology's actual "core" node
    instantiate(topo, "room_ext", 2, external_mappings={"core": "core"})

    # 2 rooms x 1 node = 2 nodes added, plus original core = 3 nodes
    assert len(topo.nodes) == 3
    assert {n.name for n in topo.nodes} == {"core", "room_ext1_sw", "room_ext2_sw"}

    # The links should be mapped: room_ext1_sw -> core, and room_ext2_sw -> core
    assert len(topo.links) == 2
    assert sorted(topo.links[0].endpoints) == ["core", "room_ext1_sw"]
    assert sorted(topo.links[1].endpoints) == ["core", "room_ext2_sw"]


def test_sibling_links_between_included_instances():
    # A building wires its two rooms to each other and its own core to room1:
    # dotted endpoints name the child instance ("room1.sw"), so units can say
    # how their parts link together, not just link up to a parent node.
    topo = Topology(
        name="lab",
        templates=[
            _room_template(),
            Template(
                name="building",
                nodes=[Node("core", device="eos")],
                links=[Link(["room1.sw", "room2.sw"]), Link(["core", "room1.sw"])],
                includes=[IncludeRef(template="room", count=2)],
            ),
        ],
    )
    instantiate(topo, "building", 1, prefix="hq")

    endpoint_sets = [sorted(link.endpoints) for link in topo.links]
    assert ["hq_room1_sw", "hq_room2_sw"] in endpoint_sets
    assert ["hq_core", "hq_room1_sw"] in endpoint_sets
    # Every link endpoint resolves to a real node — nothing dangling.
    names = {n.name for n in topo.nodes}
    assert all(e in names for link in topo.links for e in link.endpoints)


def test_instance_layout_names_match_expansion():
    """services.units.instance_layout must mirror expansion naming exactly —
    every node instantiate creates gets a position, none invented."""
    from services.units import instance_layout

    units = {
        "ws": {
            "name": "ws",
            "nodes": [{"name": "pc", "device": "linux", "x": 100, "y": 100}],
            "links": [],
            "includes": [],
            "module": [],
        },
        "room": {
            "name": "room",
            "nodes": [{"name": "sw", "device": "ovs", "x": 50, "y": 0}],
            "links": [],
            "includes": [{"template": "ws", "count": 2}],
            "module": [],
        },
        "building": {
            "name": "building",
            "nodes": [],
            "links": [],
            "includes": [{"template": "room", "count": 3}],
            "module": [],
        },
    }

    def to_template(u):
        return Template(
            name=u["name"],
            nodes=[Node(n["name"], device=n.get("device")) for n in u["nodes"]],
            links=[Link(list(link["endpoints"])) for link in u["links"]],
            includes=[IncludeRef(i["template"], i["count"]) for i in u["includes"]],
        )

    topo = Topology(name="lab", templates=[to_template(u) for u in units.values()])
    instantiate(topo, "building", 2, prefix="hq")

    layout = instance_layout(units, "building", 2, "hq", {"x": 0, "y": 0})
    assert set(layout) == {n.name for n in topo.nodes}


def test_instantiate_applies_device_and_image_overrides():
    topo = Topology(name="lab", templates=[_room_template()])
    instantiate(topo, "room", 2, overrides={"device": "eos", "image": "ceos:4.34"})

    # Every placed node is standardized to the override device + image, even
    # though the template mixes ovs/linux devices.
    assert {n.device for n in topo.nodes} == {"eos"}
    assert all(n.attrs.get("image") == "ceos:4.34" for n in topo.nodes)


def test_overrides_propagate_into_included_units():
    house = Template(name="house", nodes=[], links=[], includes=[IncludeRef("room", 2)])
    topo = Topology(name="lab", templates=[_room_template(), house])
    instantiate(topo, "house", 1, overrides={"device": "frr"})

    assert topo.nodes  # sanity: expansion produced nodes
    assert {n.device for n in topo.nodes} == {"frr"}


# --------------------------------------------------------------------------- #
# Scaling connections: "each child → hub" wiring that fans out with the count.
# (Short names keep every generated identifier within netlab's 16-char limit.)
# --------------------------------------------------------------------------- #
def _wp_template() -> Template:
    # A "workplace" (wp): one desktop, whose `pc` is the connection point.
    return Template(name="wp", nodes=[Node("pc", device="linux")])


def _room_with_wps(count: int) -> Template:
    # A "room": a switch plus `count` workplaces, each wired to the switch via a
    # single "each wp → sw" rule (a bare, count>1 include reference).
    return Template(
        name="room",
        nodes=[Node("sw", device="ovs")],
        links=[Link(["wp.pc", "sw"])],
        includes=[IncludeRef("wp", count)],
    )


def test_fanout_scales_with_include_count():
    topo = Topology(name="lab", templates=[_wp_template(), _room_with_wps(4)])
    instantiate(topo, "room", 1, prefix="room")

    assert {n.name for n in topo.nodes} == {
        "room_sw",
        "room_wp1_pc",
        "room_wp2_pc",
        "room_wp3_pc",
        "room_wp4_pc",
    }
    # The single wiring rule fanned out to one link per workplace.
    assert sorted(link.endpoints for link in topo.links) == [
        ["room_wp1_pc", "room_sw"],
        ["room_wp2_pc", "room_sw"],
        ["room_wp3_pc", "room_sw"],
        ["room_wp4_pc", "room_sw"],
    ]


def test_fanout_count_one_is_a_single_link():
    topo = Topology(name="lab", templates=[_wp_template(), _room_with_wps(1)])
    instantiate(topo, "room", 1, prefix="room")
    # count==1 keeps the bare-name instance and produces exactly one link.
    assert [link.endpoints for link in topo.links] == [["room_wp_pc", "room_sw"]]


def test_indexed_reference_targets_a_single_instance():
    room = Template(
        name="room",
        nodes=[Node("sw", device="ovs")],
        links=[Link(["wp2.pc", "sw"])],
        includes=[IncludeRef("wp", 4)],
    )
    topo = Topology(name="lab", templates=[_wp_template(), room])
    instantiate(topo, "room", 1, prefix="room")
    # An explicit index wires just that one instance — no fan-out.
    assert [link.endpoints for link in topo.links] == [["room_wp2_pc", "room_sw"]]


def test_fanout_nests_through_multiple_levels():
    building = Template(
        name="building",
        nodes=[Node("core", device="eos")],
        links=[Link(["room.sw", "core"])],
        includes=[IncludeRef("room", 2)],
    )
    topo = Topology(name="lab", templates=[_wp_template(), _room_with_wps(3), building])
    instantiate(topo, "building", 1, prefix="bld")

    endpoints = sorted(link.endpoints for link in topo.links)
    # Building level: each of the 2 rooms' switch → the core.
    assert ["bld_room1_sw", "bld_core"] in endpoints
    assert ["bld_room2_sw", "bld_core"] in endpoints
    # Room level (inside each room instance): each of the 3 workplaces → its sw.
    assert ["bld_room1_wp3_pc", "bld_room1_sw"] in endpoints
    assert ["bld_room2_wp1_pc", "bld_room2_sw"] in endpoints
    # 2 building-level links + 3 workplaces x 2 rooms = 8 links total.
    assert len(topo.links) == 8


def test_fanout_mismatched_counts_is_rejected():
    room = Template(
        name="room",
        nodes=[],
        links=[Link(["wp.pc", "pr.port"])],
        includes=[IncludeRef("wp", 4), IncludeRef("pr", 2)],
    )
    printer = Template(name="pr", nodes=[Node("port", device="linux")])
    topo = Topology(name="lab", templates=[_wp_template(), printer, room])
    with pytest.raises(ValueError, match="different instance counts"):
        instantiate(topo, "room", 1, prefix="room")
