import asyncio
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.contract.responses import LensBundleResult
from app.main import app
from services.lenses import config_diff, path_explorer, readiness, reports, teaching, validation_results
from services.lenses.analyzer import build_bundle
from services.lenses.derivation import build_derivation
from services.lenses.service_explorer import build_service_explorer
from services.lenses.validation_lens import build_validation
from services.netlab import runner


def _transformed() -> dict:
    return {
        "_netlab_version": "test",
        "addressing": {
            "lan": {"ipv4": "10.0.0.0/29", "prefix": 30, "ipv6": "2001:db8::/126", "prefix6": 127},
            "loopback": {"ipv4": "10.255.0.0/24", "prefix": 32},
        },
        "links": [
            {
                "linkindex": 1,
                "_linkname": "links[1]",
                "prefix": {"ipv4": "10.0.0.0/30", "ipv6": "2001:db8::/127"},
                "interfaces": [
                    {"node": "r1", "ifname": "eth1", "ipv4": "10.0.0.1/30", "ipv6": "2001:db8::/127"},
                    {"node": "r2", "ifname": "eth1", "ipv4": "10.0.0.2/30", "ipv6": "2001:db8::1/127"},
                ],
            },
            {
                "linkindex": 2,
                "_linkname": "links[2]",
                "prefix": {"ipv4": "10.0.0.0/30"},
                "interfaces": [
                    {"node": "r3", "ifname": "eth1", "ipv4": "10.0.0.1/30"},
                    {"node": "r4", "ifname": "eth1", "ipv4": "10.0.0.2/30"},
                ],
            },
        ],
        "nodes": {
            "r1": {
                "module": ["bgp", "ospf", "isis", "bfd", "evpn", "vrf"],
                "loopback": {"ifname": "lo", "ipv4": "10.255.0.1/32"},
                "bgp": {
                    "as": 65000,
                    "rr": True,
                    "neighbors": [
                        {
                            "name": "r2",
                            "type": "ibgp",
                            "as": 65000,
                            "activate": {"ipv4": True, "evpn": True},
                            "ipv4": "10.255.0.2",
                            "evpn": True,
                            "_source_intf": {"ifname": "lo", "ipv4": "10.255.0.1/32"},
                        }
                    ],
                },
                "ospf": {"area": "0.0.0.0"},
                "isis": {"area": "49.0001", "type": "level-1-2"},
                "evpn": {"transport": "vxlan", "session": "ibgp"},
                "interfaces": [
                    {
                        "ifname": "eth1",
                        "ipv4": "10.0.0.1/30",
                        "ospf": {"area": "0.0.0.0"},
                        "isis": {},
                        "bfd": {},
                    }
                ],
                "vrfs": {"blue": {}},
            },
            "r2": {
                "module": ["bgp", "ospf", "isis", "bfd", "evpn"],
                "loopback": {"ifname": "lo", "ipv4": "10.255.0.2/32"},
                "bgp": {
                    "as": 65000,
                    "neighbors": [
                        {
                            "name": "r1",
                            "type": "ibgp",
                            "as": 65000,
                            "activate": {"ipv4": True, "evpn": True},
                            "ipv4": "10.255.0.1",
                            "evpn": True,
                            "rr_client": True,
                            "_source_intf": {"ifname": "lo", "ipv4": "10.255.0.2/32"},
                        }
                    ],
                },
                "ospf": {"area": "0.0.0.0"},
                "isis": {"area": "49.0001", "type": "level-2"},
                "evpn": {"transport": "vxlan", "session": "ibgp"},
                "interfaces": [
                    {
                        "ifname": "eth1",
                        "ipv4": "10.0.0.2/30",
                        "ospf": {"area": "0.0.0.0"},
                        "isis": {},
                        "bfd": {},
                    }
                ],
            },
            "r3": {"interfaces": [{"ifname": "eth1", "ipv4": "10.0.0.1/30"}]},
            "r4": {"interfaces": [{"ifname": "eth1", "ipv4": "10.0.0.2/30"}]},
        },
        "validate": [
            {
                "name": "wait_ospf",
                "description": "Wait for OSPF adjacency",
                "nodes": ["r1", "r2"],
                "wait": 60,
                "wait_msg": "Waiting for OSPF",
            },
            {
                "name": "ping_core",
                "description": "r1 can reach r2",
                "nodes": ["r1"],
                "plugin": 'ping("r2")',
                "stop_on_error": True,
            },
        ],
    }


def _bundle() -> dict:
    return build_bundle(
        _transformed(),
        revision=7,
        source_hash="abc",
        source={
            "links": [
                {"interfaces": [{"node": "r1", "ipv4": "10.0.0.1/30"}, {"node": "r2"}]},
                {"interfaces": [{"node": "r3"}, {"node": "r4"}]},
            ]
        },
    )


def test_bundle_extracts_addressing_and_control_plane():
    bundle = LensBundleResult.model_validate(_bundle()).model_dump()

    assert bundle["revision"] == 7
    assert bundle["addressing"]["families"] == ["ipv4", "ipv6"]
    assert bundle["addressing"]["manualAssignmentCount"] == 4
    assert {warning["kind"] for warning in bundle["addressing"]["warnings"]} >= {
        "duplicate-address",
        "overlapping-prefix",
    }
    assert {item["protocol"] for item in bundle["controlPlane"]["adjacencies"]} >= {
        "bgp",
        "ospf",
        "isis",
        "bfd",
        "evpn",
    }
    bgp = next(item for item in bundle["controlPlane"]["adjacencies"] if item["protocol"] == "bgp")
    assert bgp["sessionType"] == "ibgp"
    assert bgp["routeReflectorNodes"] == ["r1"]
    assert "neighbor:" in bgp["resolvedYaml"]
    assert any(marker["label"] == "RR" for marker in bundle["controlPlane"]["markers"])
    assert next(item for item in bundle["addressing"]["segments"] if item["physicalEdgeIds"] == ["e0"])


def test_markdown_reports_become_searchable_tables():
    tables = reports.parse_markdown_tables("# Neighbors\n\n| Node | Peer |\n| --- | --- |\n| r1 | 10.255.0.2 |\n")

    assert tables == [
        {
            "title": "Neighbors",
            "columns": ["Node", "Peer"],
            "rows": [["r1", "10.255.0.2"]],
            "objectRefs": [[]],
        }
    ]
    reports._link_custom_rows(tables, _bundle())
    assert "node:r1" in tables[0]["objectRefs"][0]
    assert any(ref.startswith("address:") for ref in tables[0]["objectRefs"][0])


def test_builtin_report_uses_canonical_object_refs(monkeypatch):
    async def fake_catalog(_path):
        return [reports._descriptor("addressing.md", "Address plan")]

    async def fake_bundle(_path, _revision):
        return _bundle()

    monkeypatch.setattr(reports, "catalog", fake_catalog)
    monkeypatch.setattr(reports, "bundle_for", fake_bundle)

    result = asyncio.run(reports.run("/work/lab.yml", 1, "addressing.md"))

    assert result["tables"][0]["rows"]
    assert "node:r1" in result["tables"][0]["objectRefs"][0]


def test_teaching_document_round_trip(tmp_path: Path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: {r1: {}}\n")
    document = teaching.empty_document()
    document["steps"] = [
        {
            "id": "inspect-r1",
            "caption": "Meet r1",
            "note": "Our first router.",
            "view": {
                "lens": "physical",
                "family": "ipv4",
                "routingLayers": [],
                "revealRefs": ["node:r1"],
                "dimOthers": True,
                "focusRef": "node:r1",
            },
        }
    ]
    saved = teaching.save(topology, document)

    assert teaching.document_path(topology).exists()
    reloaded = teaching.load(topology)
    assert reloaded["revision"] == saved["revision"]
    assert reloaded["steps"][0]["view"]["revealRefs"] == ["node:r1"]


def test_teaching_load_discards_legacy_task_schema(tmp_path: Path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: {r1: {}}\n")
    # A pre-capture document (schemaVersion 1, tasks instead of view) can't be
    # replayed, so load() should fall back to an empty tour rather than crash.
    teaching.document_path(topology).write_text('{"schemaVersion": 1, "steps": [{"id": "x", "tasks": []}]}')
    assert teaching.load(topology)["steps"] == []


def test_create_cache_coalesces_unchanged_topology(tmp_path: Path, monkeypatch):
    topology = tmp_path / "lab.yml"
    topology.write_text("name: cached\nnodes: {r1: {}}\n")
    calls = 0

    async def fake_run(args, cwd=None):
        nonlocal calls
        calls += 1
        assert args.index("config") < args.index("provider")
        destination = next(arg.split("=", 1)[1] for arg in args if arg.startswith("json="))
        Path(destination).write_text(json.dumps({"name": "cached", "nodes": {"r1": {}}}))
        await asyncio.sleep(0.01)
        return runner.CommandResult(0, "created", "")

    monkeypatch.setattr(runner, "_run", fake_run)
    monkeypatch.setattr(runner, "_read_clab_projection", lambda _cwd, _snapshot: {"name": "cached"})
    runner._create_cache.clear()
    runner._create_locks.clear()

    async def collect():
        return await asyncio.gather(runner.create(topology), runner.create(topology))

    first, second = asyncio.run(collect())

    assert calls == 1
    assert first == second


def test_lens_endpoint_resolves_the_live_session(tmp_path: Path, monkeypatch):
    topology = tmp_path / "lab.yml"
    topology.write_text("name: lab\nnodes: {r1: {}}\n")

    async def fake_bundle(path, revision):
        assert path == str(topology)
        assert revision == 1
        return _bundle()

    monkeypatch.setattr("app.lenses.router.service.bundle_for", fake_bundle)
    client = TestClient(app)
    session = client.post("/api/topology/sessions", json={"topologyPath": str(topology)}).json()

    response = client.get("/api/topology/lenses", params={"sessionId": session["sessionId"]})

    assert response.status_code == 200
    assert response.json()["schemaVersion"] == 1


def test_validation_lens_builds_suite_from_transformed_topology():
    bundle = LensBundleResult.model_validate(_bundle()).model_dump()
    validation_lens = bundle["validation"]

    assert validation_lens["available"] is True
    assert validation_lens["summary"]["total"] == 2
    tests = {test["name"]: test for test in validation_lens["tests"]}
    assert tests["wait_ospf"]["kind"] == "wait"
    assert tests["wait_ospf"]["waitSeconds"] == 60
    assert tests["wait_ospf"]["objectRefs"] == ["node:r1", "node:r2", "validation:wait_ospf"]
    assert tests["ping_core"]["kind"] == "plugin"
    assert tests["ping_core"]["stopOnError"] is True
    # No run yet → every test is unknown.
    assert all(test["state"] == "unknown" for test in validation_lens["tests"])


def test_validation_results_parser_classifies_per_test_outcomes():
    output = (
        "Running validation tests\n"
        "wait_ospf: Wait for OSPF adjacency\n"
        "  r1: OK\n"
        "  r2: OK\n"
        "PASS: wait_ospf completed\n"
        "ping_core: r1 can reach r2\n"
        "  r1: connect: Network is unreachable\n"
        "FAIL: ping_core\n"
    )
    parsed = validation_results.parse(output, ["wait_ospf", "ping_core"])

    assert parsed["wait_ospf"]["state"] == "passed"
    assert parsed["ping_core"]["state"] == "failed"
    assert any("unreachable" in line for line in parsed["ping_core"]["evidence"])


def _service_topology() -> dict:
    return {
        "vlans": {
            "red": {"id": 1000, "mode": "bridge", "prefix": {"ipv4": "172.16.0.0/24"}},
            "blue": {"id": 1001, "mode": "irb", "vrf": "tenant", "prefix": {"ipv4": "172.16.1.0/24"}},
        },
        "vrfs": {"tenant": {"id": 1, "rd": "65000:1", "import": ["65000:1"], "export": ["65000:1"]}},
        "vxlan": {"flooding": "evpn", "vlans": ["red", "blue"]},
        "evpn": {"session": ["ibgp"], "vlans": ["red", "blue"], "vrfs": ["tenant"]},
        "links": [
            {
                "linkindex": 1,
                "interfaces": [
                    {"node": "s1", "vlan": {"access": "red"}},
                    {"node": "h1"},
                ],
            },
            {
                "linkindex": 2,
                "interfaces": [
                    {"node": "s1", "vlan": {"access": "blue"}},
                    {"node": "s2", "vlan": {"access": "blue"}},
                ],
            },
        ],
        "nodes": {
            "s1": {
                "vlans": {
                    "red": {
                        "id": 1000,
                        "mode": "bridge",
                        "vni": 101000,
                        "evpn": {
                            "evi": 1000,
                            "rd": "10.0.0.1:1000",
                            "import": ["65000:1000"],
                            "export": ["65000:1000"],
                        },
                    },
                    "blue": {"id": 1001, "mode": "irb", "vni": 101001, "vrf": "tenant"},
                },
                "vrfs": {"tenant": {"id": 1, "rd": "65000:1"}},
                "vxlan": {"vtep": "10.0.0.1", "vtep_interface": "lo", "vlans": ["red", "blue"]},
            },
            "s2": {
                "vlans": {"blue": {"id": 1001, "mode": "irb", "vni": 101001, "vrf": "tenant"}},
                "vrfs": {"tenant": {"id": 1, "rd": "65000:1"}},
                "vxlan": {"vtep": "10.0.0.2", "vtep_interface": "lo", "vlans": ["blue"]},
            },
            "h1": {},
        },
    }


def test_service_explorer_maps_vlans_vrfs_and_vxlan():
    explorer = build_service_explorer(_service_topology())

    assert explorer["available"] is True
    vlans = {vlan["name"]: vlan for vlan in explorer["vlans"]}
    assert vlans["red"]["vni"] == 101000
    assert vlans["red"]["physicalEdgeIds"] == ["e0"]
    assert vlans["red"]["evpn"]["evi"] == 1000
    assert set(vlans["red"]["nodeIds"]) == {"s1", "h1"}
    assert vlans["blue"]["mode"] == "irb"
    assert vlans["blue"]["vrf"] == "tenant"
    assert set(vlans["blue"]["sviNodeIds"]) == {"s1", "s2"}

    tenant = next(vrf for vrf in explorer["vrfs"] if vrf["name"] == "tenant")
    assert tenant["rd"] == "65000:1"
    assert tenant["vlans"] == ["blue"]
    assert set(tenant["nodeIds"]) == {"s1", "s2"}
    assert tenant["objectRefs"][0] == "vrf:tenant"

    assert {vtep["node"] for vtep in explorer["vteps"]} == {"s1", "s2"}
    # s1 and s2 both carry VLAN blue over VXLAN → one tunnel between them.
    assert any({tunnel["source"], tunnel["target"]} == {"s1", "s2"} for tunnel in explorer["tunnels"])
    assert explorer["evpn"]["enabled"] is True


def test_service_explorer_absent_without_services():
    explorer = build_service_explorer({"nodes": {"r1": {}}, "links": []})
    assert explorer["available"] is False
    assert explorer["vlans"] == []


def _path_topology() -> dict:
    """Triangle r1-r2-r3 where the direct r1->r3 link is expensive (cost 50)."""

    def iface(ifname, ipv4, neighbor_node, neighbor_if, neighbor_ipv4, linkindex, cost=None, passive=False):
        ospf = {"passive": passive}
        if cost is not None:
            ospf["cost"] = cost
        return {
            "ifname": ifname,
            "ipv4": ipv4,
            "linkindex": linkindex,
            "ospf": ospf,
            "neighbors": [{"node": neighbor_node, "ifname": neighbor_if, "ipv4": neighbor_ipv4}],
        }

    return {
        "nodes": {
            "r1": {
                "loopback": {"ipv4": "10.0.0.1/32"},
                "interfaces": [
                    iface("eth1", "10.1.0.1/30", "r2", "eth1", "10.1.0.2/30", 1),
                    iface("eth2", "10.1.0.9/30", "r3", "eth2", "10.1.0.10/30", 3, cost=50),
                ],
            },
            "r2": {
                "loopback": {"ipv4": "10.0.0.2/32"},
                "interfaces": [
                    iface("eth1", "10.1.0.2/30", "r1", "eth1", "10.1.0.1/30", 1),
                    iface("eth2", "10.1.0.5/30", "r3", "eth1", "10.1.0.6/30", 2),
                ],
            },
            "r3": {
                "loopback": {"ipv4": "10.0.0.3/32"},
                "interfaces": [
                    iface("eth1", "10.1.0.6/30", "r2", "eth2", "10.1.0.5/30", 2),
                    iface("eth2", "10.1.0.10/30", "r1", "eth2", "10.1.0.9/30", 3),
                ],
            },
        }
    }


def test_path_explorer_prefers_cheaper_igp_path():
    snap = _path_topology()
    result = path_explorer.compute_path(snap, source="r1", target="r3", family="ipv4", vrf="default")

    assert result["reachable"] is True
    # r1->r3 direct link costs 50, so the two-hop r1->r2->r3 path (cost 2) wins.
    assert result["hopCount"] == 2
    assert [hop["toNode"] for hop in result["hops"]] == ["r2", "r3"]
    assert result["protocols"] == ["ospf"]
    assert "e0" in result["objectRefs"] and "e1" in result["objectRefs"]


def test_path_explorer_reports_blockages():
    snap = _path_topology()

    wrong_family = path_explorer.compute_path(snap, source="r1", target="r3", family="ipv6", vrf="default")
    assert wrong_family["reachable"] is False
    assert wrong_family["blockage"] == "no-address"

    wrong_vrf = path_explorer.compute_path(snap, source="r1", target="r3", family="ipv4", vrf="tenant")
    assert wrong_vrf["blockage"] == "no-address"

    unknown = path_explorer.compute_path(snap, source="r1", target="ghost", family="ipv4", vrf="default")
    assert unknown["blockage"] == "unknown-node"


def test_path_explorer_graph_cache_reuses_and_invalidates():
    path_explorer._graph_cache.clear()
    snap = _path_topology()

    first = path_explorer.compute_path(snap, source="r1", target="r3", snapshot_key="hashA")
    assert first["reachable"] is True
    assert ("hashA", "ipv4", "default") in path_explorer._graph_cache
    cached_graph = path_explorer._graph_cache[("hashA", "ipv4", "default")]

    # Same key ⇒ same cached graph object reused (no rebuild).
    path_explorer.compute_path(snap, source="r2", target="r3", snapshot_key="hashA")
    assert path_explorer._graph_cache[("hashA", "ipv4", "default")] is cached_graph

    # Different content hash ⇒ separate entry, rebuilt from the given snapshot.
    path_explorer.compute_path(snap, source="r1", target="r3", snapshot_key="hashB")
    assert ("hashB", "ipv4", "default") in path_explorer._graph_cache

    # No key ⇒ correct result, nothing cached.
    path_explorer._graph_cache.clear()
    uncached = path_explorer.compute_path(snap, source="r1", target="r3")
    assert uncached["reachable"] is True
    assert not path_explorer._graph_cache


def test_reachability_picker_lists_nodes_and_families():
    reach = path_explorer.build_reachability(_path_topology())
    assert reach["available"] is True
    assert reach["families"] == ["ipv4"]
    assert reach["nodes"] == ["r1", "r2", "r3"]


def test_derivation_classifies_authored_inherited_and_computed():
    transformed = {
        "nodes": {
            "r1": {
                "device": "frr",
                "module": ["bgp"],
                "id": 1,
                "role": "router",
                "bgp": {"as": 65001},
                "loopback": {"ipv4": "10.0.0.1/32"},
            },
            "r2": {
                "device": "frr",
                "module": ["bgp"],
                "id": 2,
                "role": "router",
                "bgp": {"as": 65000},
                "loopback": {"ipv4": "10.0.0.2/32"},
            },
        }
    }
    # Source uses netlab's dotted-key shorthand and a group.
    source = {
        "module": ["bgp"],
        "bgp.as": 65000,
        "groups": {"core": {"members": ["r1", "r2"], "device": "frr", "role": "router"}},
        "nodes": {"r1": {"bgp.as": 65001}, "r2": {}},
    }
    derivation = build_derivation(transformed, source)
    fields = {row["node"]: {field["label"]: field for field in row["fields"]} for row in derivation["nodes"]}

    assert fields["r1"]["BGP AS"]["origin"] == "authored"
    assert fields["r2"]["BGP AS"]["origin"] == "inherited"
    assert fields["r2"]["BGP AS"]["source"] == "global default"
    assert fields["r1"]["Device"]["origin"] == "inherited"
    assert fields["r1"]["Device"]["source"] == "group core"
    assert fields["r1"]["Node ID"]["origin"] == "computed"
    assert fields["r1"]["Modules"]["origin"] == "inherited"


def test_derivation_absent_without_source_nodes():
    derivation = build_derivation({"nodes": {"r1": {"device": "frr"}}}, {})
    assert derivation["available"] is False


def test_config_diff_groups_by_module_and_counts_changes(monkeypatch):
    files = {
        "r1": [
            {"path": "01-initial.sh", "content": "hostname r1\n"},
            {"path": "03-ospf.sh", "content": "router ospf\n area 0\n"},
        ],
        "r2": [
            {"path": "01-initial.sh", "content": "hostname r2\n"},
            {"path": "05-bgp.sh", "content": "router bgp 65000\n"},
        ],
    }
    monkeypatch.setattr(config_diff.config_preview, "read_node_files", lambda _path, node: files[node])

    result = config_diff.build_config_diff("/work/lab.yml", "r1", "r2")

    by_path = {file["path"]: file for file in result["files"]}
    assert by_path["01-initial.sh"]["module"] == "initial"
    assert by_path["01-initial.sh"]["identical"] is False
    assert by_path["01-initial.sh"]["leftContent"] == "hostname r1\n"
    assert by_path["01-initial.sh"]["rightContent"] == "hostname r2\n"
    assert by_path["03-ospf.sh"]["module"] == "ospf"
    assert by_path["03-ospf.sh"]["leftPresent"] and not by_path["03-ospf.sh"]["rightPresent"]
    assert by_path["05-bgp.sh"]["rightPresent"] and not by_path["05-bgp.sh"]["leftPresent"]
    assert result["summary"] == {"same": 0, "different": 1, "onlyLeft": 1, "onlyRight": 1}


def test_readiness_explains_transform_failure(monkeypatch):
    async def fake_create(_path):
        raise runner.NetlabError(["netlab", "create"], 1, "FatalError in clab: Open vSwitch is not installed\n... hint")

    monkeypatch.setattr(readiness.runner, "create", fake_create)
    result = asyncio.run(readiness.build_readiness("/work/lab.yml"))

    assert result["ready"] is False
    assert result["summary"]["fail"] == 1
    assert result["checks"][0]["id"] == "transform"
    assert "Open vSwitch" in result["checks"][0]["detail"]


def test_readiness_flags_missing_images_and_inactive_modules(monkeypatch):
    artifact = {
        "snapshot": {
            "name": "lab",
            "provider": "clab",
            "nodes": {
                "s1": {"box": "ceos:4.34.2F"},
                "s2": {"box": "quay.io/frr:10"},
            },
        },
        "stderr": "Warning in vrf: Node s1 uses no VRFs, removing 'vrf' from node modules\n",
    }

    async def fake_create(_path):
        return artifact

    async def fake_images():
        return [{"repoTags": ["quay.io/frr:10"]}]

    monkeypatch.setattr(readiness.runner, "create", fake_create)
    monkeypatch.setattr(readiness.runner, "is_containerlab_installed", lambda: True)
    monkeypatch.setattr("app.lab.images.list_docker_images", fake_images)

    result = asyncio.run(readiness.build_readiness("/work/lab.yml"))
    checks = {check["id"]: check for check in result["checks"]}

    assert checks["images"]["status"] == "warn"
    assert any("ceos" in item for item in checks["images"]["items"])
    assert checks["modules"]["status"] == "info"
    assert "s1: vrf" in checks["modules"]["items"]
    assert checks["provider"]["status"] == "pass"


def test_readiness_groups_missing_images_by_image(monkeypatch):
    # A lab with many nodes sharing the same missing image must produce one
    # grouped line, not one line per node.
    node_names = [f"pc{i}" for i in range(10)]
    artifact = {
        "snapshot": {
            "name": "lab",
            "provider": "clab",
            "nodes": {name: {"box": "quay.io/frrouting/frr:10.6.1"} for name in node_names},
        },
        "stderr": "",
    }

    async def fake_create(_path):
        return artifact

    async def fake_images():
        return []

    monkeypatch.setattr(readiness.runner, "create", fake_create)
    monkeypatch.setattr(readiness.runner, "is_containerlab_installed", lambda: True)
    monkeypatch.setattr("app.lab.images.list_docker_images", fake_images)

    result = asyncio.run(readiness.build_readiness("/work/lab.yml"))
    checks = {check["id"]: check for check in result["checks"]}

    images_check = checks["images"]
    assert images_check["status"] == "warn"
    # One grouped item for the shared image, not ten.
    assert len(images_check["items"]) == 1
    assert "quay.io/frrouting/frr:10.6.1 — 10 node(s):" in images_check["items"][0]
    assert images_check["items"][0].endswith("pc[0-9]")
    # But every node is still individually selectable via objectRefs.
    assert len(images_check["objectRefs"]) == 10


def test_validation_lens_overlays_run_results():
    validation_lens = build_validation(
        _transformed(),
        {
            "results": {
                "wait_ospf": {"state": "passed", "evidence": ["PASS: wait_ospf"]},
                "ping_core": {"state": "failed", "evidence": ["FAIL: ping_core"]},
            },
            "ranAt": "2026-07-20T00:00:00Z",
        },
    )

    assert validation_lens["hasRun"] is True
    assert validation_lens["summary"] == {"total": 2, "passed": 1, "failed": 1, "warning": 0, "unknown": 0}
    failed = next(test for test in validation_lens["tests"] if test["name"] == "ping_core")
    assert failed["state"] == "failed"
    assert failed["evidence"] == ["FAIL: ping_core"]
