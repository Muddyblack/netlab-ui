from pathlib import Path

import pytest

from app.contract.router.groups import NetlabLinkPut, save_netlab_link
from app.sessions.store import store
from services.model import serialize
from services.model.topology import Node, Topology
from services.netlab import link_authoring


def topology() -> Topology:
    return Topology(name="links", nodes=[Node("r1"), Node("r2"), Node("r3")])


def test_add_stub_emits_single_node_link():
    topo = topology()
    link_authoring.add_stub(topo, ["r1"], "edge stub")

    data = serialize.to_dict(topo)
    assert data["links"] == [{"interfaces": [{"node": "r1"}], "name": "edge stub"}]


def test_add_lan_preserves_name_and_bridge():
    topo = topology()
    link_authoring.add_lan(topo, ["r1", "r2", "r3"], "users", "br-users")

    link = serialize.to_dict(topo)["links"][0]
    assert link["interfaces"] == [{"node": "r1"}, {"node": "r2"}, {"node": "r3"}]
    assert link["type"] == "lan"
    assert link["name"] == "users"
    assert link["bridge"] == "br-users"


def test_add_uplink_emits_clab_uplink():
    topo = topology()
    link_authoring.add_uplink(topo, ["r1"], "enp5s0")

    link = serialize.to_dict(topo)["links"][0]
    assert link["interfaces"] == [{"node": "r1"}]
    assert link["clab"] == {"uplink": "enp5s0"}


def test_set_bridge_type_preserves_other_defaults():
    topo = topology()
    topo.defaults = {"device": "srl", "providers": {"clab": {"runtime": "podman"}}}
    link_authoring.set_bridge_type(topo, "ovs-bridge")

    assert topo.defaults == {
        "device": "srl",
        "providers": {"clab": {"runtime": "podman", "bridge_type": "ovs-bridge"}},
    }


def test_set_bridge_type_rejects_unknown_implementation():
    with pytest.raises(ValueError, match="bridge type"):
        link_authoring.set_bridge_type(topology(), "macvlan")


@pytest.mark.parametrize("nodes", [[], ["missing"], ["r1", "r2"]])
def test_stub_rejects_invalid_node_selection(nodes):
    with pytest.raises(ValueError):
        link_authoring.add_stub(topology(), nodes)


def test_endpoint_writes_link_and_bumps_revision(tmp_path):
    topo_path = str(tmp_path / "lab.yml")
    Path(topo_path).write_text("name: lab\nnodes: [r1, r2]\n")
    session = store.create(topo_path)

    response = save_netlab_link(
        session.id,
        NetlabLinkPut(kind="lan", nodes=["r1", "r2"], name="inside"),
    )

    assert response["revision"] == 2
    saved = serialize.from_yaml(Path(topo_path).read_text())
    assert saved.links[0].endpoints == ["r1", "r2"]
    assert saved.links[0].attrs == {"type": "lan", "name": "inside"}
