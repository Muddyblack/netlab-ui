from netlab_monitoring import plan


def test_plan_names_containers_interfaces_and_methods(topology):
    p = plan.build(topology)
    r1 = p["nodes"]["r1"]
    assert r1["container"] == "clab-lab3-r1"
    assert r1["methods"] == ["host", "frr"]
    assert set(r1["frr"]["protocols"]) == {"ospf", "isis", "bgp", "bfd"}
    eth1 = next(i for i in r1["interfaces"] if i["ifname"] == "eth1")
    assert eth1 == {
        "ifname": "eth1",
        "dev": "eth1",
        "link": "r1-r2",
        "nic": 1,
        "peer_node": "r2",
        "peer_ifname": "eth1",
    }
    assert p["nodes"]["h1"]["methods"] == ["host"]
    assert r1["mgmt"]["dev"] == "eth0"


def test_plan_maps_addresses_and_router_ids_to_nodes(topology):
    p = plan.build(topology)
    assert p["addresses"]["10.0.0.2"] == "r2"  # loopback
    assert p["addresses"]["10.1.0.10"] == "r3"  # p2p interface
    assert p["router_ids"]["10.0.0.3"] == "r3"


def test_expected_state_comes_from_the_topology(topology):
    expected = plan.build(topology)["expected"]
    bgp = {(e["node"], e["peer"], e["peer_node"], e["type"]) for e in expected["bgp"]}
    assert ("r1", "10.0.0.2", "r2", "ibgp") in bgp
    assert ("r1", "10.1.0.10", "r3", "ebgp") in bgp
    assert len(bgp) == 6
    # r3 is in another AS and runs no IGP: only r1<->r2 adjacencies are expected
    assert {(e["node"], e["peer_node"]) for e in expected["ospf"]} == {("r1", "r2"), ("r2", "r1")}
    assert {(e["node"], e["peer_node"]) for e in expected["isis"]} == {("r1", "r2"), ("r2", "r1")}


def test_node_selection_and_opt_out(topology):
    topology["monitoring"]["nodes"] = ["r1", "r2"]
    assert plan.selected_nodes(topology) == ["r1", "r2"]
    p = plan.build(topology)
    assert set(p["nodes"]) == {"r1", "r2"}
    assert all(e["peer_node"] in {"r1", "r2"} for e in p["expected"]["bgp"])
    topology["monitoring"]["nodes"] = []
    topology["nodes"]["h1"]["monitoring"] = {"enabled": False}
    assert "h1" not in plan.selected_nodes(topology)


def test_profiles_inherit_and_unknown_devices_fall_back_to_host():
    profiles = {
        "frr": {"method": "frr", "frr": {"socket_dirs": ["run/frr"]}},
        "vyos": {"use": "frr", "frr": {"extra": 1}},
    }
    assert plan.resolve_profile(profiles, "vyos") == {"method": "frr", "frr": {"socket_dirs": ["run/frr"], "extra": 1}}
    assert plan.resolve_profile(profiles, "unknown") == {"method": "host"}


def test_frr_on_libvirt_falls_back_to_host_metrics(topology):
    topology["nodes"]["r3"]["provider"] = "libvirt"
    node = plan.build(topology)["nodes"]["r3"]
    assert node["methods"] == ["host"]
    assert node["domain"] == "lab3_r3"


def test_container_names_follow_the_clab_prefix(topology):
    topology["defaults"]["providers"]["clab"]["lab_prefix"] = ""
    assert plan.container_name(topology, "r1") == "r1"
    topology["defaults"]["providers"]["clab"]["lab_prefix"] = "__lab-name"
    assert plan.container_name(topology, "r1") == "lab3-r1"
