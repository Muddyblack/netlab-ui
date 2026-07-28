"""Round-trip tests for the netlab source model <-> YAML serializer.

The key invariants:
  * load -> emit -> load is stable (no semantic drift)
  * coordinates never appear in the emitted YAML (layout lives in the sidecar)
"""

from services.model import serialize
from services.model.topology import Link, Node, Topology

SAMPLE = """
name: campus
provider: clab
defaults:
  device: frr
nodes:
  r1:
    device: frr
  r2:
    device: eos
  h1:
links:
  - r1-r2
  - interfaces:
      - node: r1
      - node: h1
    prefix: 10.0.0.0/24
groups:
  routers:
    members:
      - r1
      - r2
    module:
      - ospf
"""


def test_parse_basic():
    topo = serialize.from_yaml(SAMPLE)
    assert topo.name == "campus"
    assert topo.provider == "clab"
    assert topo.defaults == {"device": "frr"}
    assert {n.name for n in topo.nodes} == {"r1", "r2", "h1"}
    assert topo.node("r2").device == "eos"
    # h1 has no device -> None
    assert topo.node("h1").device is None
    routers = topo.group("routers")
    assert routers.members == ["r1", "r2"]
    assert routers.module == ["ospf"]


def test_links_parsed_both_forms():
    topo = serialize.from_yaml(SAMPLE)
    assert topo.links[0].endpoints == ["r1", "r2"]
    rich = topo.links[1]
    assert rich.endpoints == ["r1", "h1"]
    assert rich.attrs.get("prefix") == "10.0.0.0/24"


def test_round_trip_is_stable():
    topo = serialize.from_yaml(SAMPLE)
    once = serialize.to_yaml(topo)
    twice = serialize.to_yaml(serialize.from_yaml(once))
    assert once == twice


def test_compact_link_emitted_for_simple_pair():
    topo = Topology(name="t", nodes=[Node("a"), Node("b")], links=[Link(["a", "b"])])
    out = serialize.to_yaml(topo)
    assert "a-b" in out
    assert "interfaces" not in out


def test_rich_link_emits_interfaces():
    topo = Topology(
        name="t",
        nodes=[Node("a"), Node("b")],
        links=[Link(["a", "b"], attrs={"prefix": "10.0.0.0/24"})],
    )
    out = serialize.to_yaml(topo)
    assert "interfaces" in out
    assert "prefix" in out


def test_no_coordinates_in_yaml():
    # Layout must never leak into the topology YAML. Check the actual coordinate
    # carriers (clab uses graph-posX/Y labels; we use a positions sidecar) rather
    # than naive substrings like "x:" which also match "prefix:".
    topo = serialize.from_yaml(SAMPLE)
    out = serialize.to_yaml(topo)
    for banned in ("graph-pos", "position:", "positions:"):
        assert banned not in out


def test_unknown_attrs_preserved():
    topo = serialize.from_yaml("name: t\nmodule: [ospf]\nnodes:\n  r1:\n    bgp:\n      as: 65000\n")
    out = serialize.to_yaml(topo)
    assert "module" in out  # top-level unknown key preserved
    assert "as: 65000" in out  # nested node attr preserved


def test_plugin_stays_top_level_before_module_and_nodes():
    topo = serialize.from_yaml("name: t\nprovider: clab\nmodule: [ bgp ]\nplugin: [ bgp.session ]\nnodes:\n  r1:\n")
    out = serialize.to_yaml(topo)
    assert out.index("provider: clab") < out.index("plugin:")
    assert out.index("plugin:") < out.index("module:")
    assert out.index("module:") < out.index("nodes:")


def test_plugin_is_not_pushed_below_groups():
    topo = serialize.from_yaml(
        "name: t\nprovider: clab\ngroups:\n  routers:\n    members: [r1]\nplugin: [ bgp.domain ]\nnodes:\n  r1:\n"
    )
    out = serialize.to_yaml(topo)
    assert out.index("plugin:") < out.index("groups:")
