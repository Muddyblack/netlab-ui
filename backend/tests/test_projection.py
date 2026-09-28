from app.contract import snapshot
from services.netlab import projection

TRANSFORMED = {
    "name": "vmlab",
    "provider": "libvirt",
    "nodes": {
        "r1": {"device": "eos", "box": "arista/veos", "mgmt": {"ipv4": "192.168.121.101"}},
        "r2": {"device": "frr", "box": "debian/bookworm64"},
        "h1": {"device": "linux", "provider": "clab", "image": "python:3.13-alpine"},
    },
    "links": [
        {"interfaces": [{"node": "r1", "ifname": "Ethernet1"}, {"node": "r2", "ifname": "eth1"}], "type": "p2p"},
        {
            "bridge": "vmlab_2",
            "interfaces": [
                {"node": "r1", "ifname": "Ethernet2"},
                {"node": "r2", "ifname": "eth2"},
                {"node": "h1", "ifname": "eth1"},
            ],
            "type": "lan",
        },
        {"interfaces": [{"node": "r2", "ifname": "eth3"}], "type": "stub"},
    ],
}


def test_projection_keeps_netlab_interface_names_and_providers():
    clab = projection.from_transformed(TRANSFORMED)
    nodes = clab["topology"]["nodes"]
    assert nodes["r1"] == {
        "kind": "eos",
        "image": "arista/veos",
        "labels": {"netlab-provider": "libvirt"},
        "mgmt-ipv4": "192.168.121.101",
    }
    assert nodes["h1"]["labels"] == {"netlab-provider": "clab"}
    assert nodes["vmlab_2"]["kind"] == "bridge"
    assert clab["topology"]["links"] == [
        {"endpoints": ["r1:Ethernet1", "r2:eth1"]},
        {"endpoints": ["r1:Ethernet2", "vmlab_2:"]},
        {"endpoints": ["r2:eth2", "vmlab_2:"]},
        {"endpoints": ["h1:eth1", "vmlab_2:"]},
    ]


def test_all_container_labs_keep_the_clab_projection_mixed_labs_use_the_transform():
    clab_only = {"provider": "clab", "nodes": {"r1": {"device": "frr"}}, "links": []}
    clab_yml = {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}
    nodes, _edges, source = snapshot._projection_from_create({"snapshot": clab_only, "clab": clab_yml}, ([], []))
    assert source == "clab" and nodes[0]["kind"] == "linux"

    mixed = {**clab_only, "nodes": {"r1": {"device": "frr"}, "vm": {"device": "eos", "provider": "libvirt"}}}
    nodes, _edges, source = snapshot._projection_from_create({"snapshot": mixed, "clab": clab_yml}, ([], []))
    assert source == "transform" and {n["id"] for n in nodes} == {"r1", "vm"}

    _n, _e, source = snapshot._projection_from_create({"snapshot": clab_only, "clab": None}, ([], []))
    assert source == "failed-preview"
