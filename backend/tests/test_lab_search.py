from services.lenses import search

TRANSFORMED = {
    "nodes": {
        "r1": {
            "id": 1,
            "device": "frr",
            "module": ["ospf", "bgp"],
            "bgp": {"as": 65001},
            "mgmt": {"ifname": "eth0", "ipv4": "192.168.121.101"},
            "loopback": {"ifname": "lo", "ipv4": "10.0.0.1/32", "type": "loopback"},
            "interfaces": [
                {"ifname": "eth1", "ipv4": "10.1.0.1/30", "neighbors": [{"node": "r2", "ifname": "eth1"}]},
            ],
            "vlans": {"red": {"id": 10}},
        },
        "r2": {
            "id": 2,
            "device": "eos",
            "module": ["ospf"],
            "bgp": {"as": 65002},
            "interfaces": [{"ifname": "eth1", "ipv4": "10.1.0.2/30", "neighbors": [{"node": "r1"}]}],
            "vrfs": {"blue": {"rd": "65002:1"}},
        },
    },
    "groups": {"core": {"members": ["r1", "r2"]}, "_internal": {"members": ["r1"]}},
}


def titles(query):
    return [(hit["kind"], hit["title"]) for hit in search.search(TRANSFORMED, query)]


def test_exact_address_ranks_before_its_subnet_neighbours():
    hits = search.search(TRANSFORMED, "10.1.0.2")
    assert hits[0]["title"] == "10.1.0.2/30" and hits[0]["nodes"] == ["r2", "r1"]
    assert ("ip", "10.1.0.1/30") in titles("10.1.0.2")  # same subnet
    assert ("ip", "10.0.0.1/32") not in titles("10.1.0.2")


def test_prefix_finds_every_address_inside_it():
    assert {t for _k, t in titles("10.0.0.0/8")} == {"10.0.0.1/32", "10.1.0.1/30", "10.1.0.2/30"}
    assert titles("192.168.121.101") == [("ip", "192.168.121.101")]


def test_as_vlan_and_numbers():
    assert titles("as 65001") == [("as", "AS 65001")]
    assert titles("AS65002") == [("as", "AS 65002")]
    assert ("vlan", "VLAN red") in titles("10")
    assert ("node", "r2") in titles("2")


def test_shared_facts_are_merged_with_all_their_nodes():
    ospf = next(hit for hit in search.search(TRANSFORMED, "ospf") if hit["kind"] == "module")
    assert ospf["nodes"] == ["r1", "r2"] and ospf["detail"].startswith("2 nodes")
    assert [m["title"] for m in search.modules(TRANSFORMED)] == ["ospf", "bgp"]


def test_kind_prefix_restricts_and_lists():
    assert titles("module:") == [("module", "ospf"), ("module", "bgp")]
    assert titles("vrf:blu") == [("vrf", "VRF blue")]
    assert titles("group:") == [("group", "core")]  # internal groups hidden
    assert titles("device:eos") == [("device", "eos")]
    assert titles("") == []
