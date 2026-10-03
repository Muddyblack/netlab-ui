import json

import yaml
from netlab_monitoring import plan, render


def rendered(topology, **overrides):
    topology["monitoring"].update(overrides)
    return render.render_all(topology, plan.build(topology))


def test_tool_placement_files(topology):
    files = rendered(topology)
    for name in (
        "plan.json",
        "tsdb/scrape.yml",
        "up.sh",
        "down.sh",
        "README.md",
        "collector/nlmon/__main__.py",
        "grafana/provisioning/datasources/netlab.yml",
        "grafana/dashboards/netlab-overview.json",
    ):
        assert name in files
    scrape = yaml.safe_load(files["tsdb/scrape.yml"])
    assert scrape["scrape_configs"][0]["static_configs"][0]["targets"] == ["127.0.0.1:9480"]
    assert "gnmic/gnmic.yml" not in files  # no gNMI devices in this lab
    up = files["up.sh"]
    assert "--name lab3_mon_collector" in up and "--pid host" in up and "--name lab3_mon_gnmic" not in up
    assert "victoriametrics/victoria-metrics" in up


def test_multilab_offsets_ports(topology):
    topology.setdefault("defaults", {})["multilab"] = {"id": 3}
    files = rendered(topology)
    assert "127.0.0.1:9483" in files["tsdb/scrape.yml"]
    assert "GF_SERVER_HTTP_PORT=3003" in files["up.sh"]


def test_gnmi_and_snmp_nodes_get_their_collectors(topology):
    topology["nodes"]["r3"]["device"] = "srlinux"
    topology["nodes"]["r3"]["interfaces"][0]["clab"] = {"name": "e1-1"}
    topology["nodes"]["r2"]["device"] = "iosv"
    files = rendered(topology)
    gnmic = yaml.safe_load(files["gnmic/gnmic.yml"])
    target = next(iter(gnmic["targets"].values()))
    assert target["name"] == "r3" and target["subscriptions"] == ["srlinux"]
    assert "INTERFACES" in files["gnmic/netlab_map.star"] and '"e1-1"' in files["gnmic/netlab_map.star"]
    scrape = yaml.safe_load(files["tsdb/scrape.yml"])
    jobs = {j["job_name"]: j for j in scrape["scrape_configs"]}
    assert set(jobs) >= {"netlab", "gnmi", "snmp"}
    assert jobs["snmp"]["static_configs"][0]["labels"]["node"] == "r2"
    assert "--name lab3_mon_snmp" in files["up.sh"]


def test_dashboards_are_valid_and_use_canonical_metrics(topology):
    files = rendered(topology)
    for name in ("netlab-overview", "netlab-routing", "netlab-node"):
        board = json.loads(files[f"grafana/dashboards/{name}.json"])
        assert board["uid"] == name
        exprs = [t["expr"] for p in board["panels"] for t in p.get("targets", [])]
        assert exprs and all("netlab_" in e for e in exprs)
        ids = [p["id"] for p in board["panels"]]
        assert len(ids) == len(set(ids))
        for panel in board["panels"]:
            pos = panel["gridPos"]
            assert pos["x"] + pos["w"] <= 24


def test_node_placement_components(topology):
    cfg = dict(topology["monitoring"], placement="node")
    nodes = render.component_nodes(cfg, needs_gnmi=False, needs_snmp=False)
    assert set(nodes) == {"mon-collector", "mon-tsdb", "mon-vmalert", "mon-grafana"}
    assert "/proc:/host/proc:ro" in nodes["mon-collector"]["binds"]
    topology["monitoring"]["placement"] = "node"
    files = render.render_all(
        topology, plan.build(topology), {"collector": "192.168.121.110", "tsdb": "192.168.121.111"}
    )
    assert "192.168.121.110:9480" in files["tsdb/scrape.yml"]
    assert "http://192.168.121.111:8428" in files["grafana/provisioning/datasources/netlab.yml"]
    assert "docker run" not in files["up.sh"]


def test_stack_info_tells_tools_where_the_stack_is(topology):
    files = rendered(topology)
    info = json.loads(files["stack.json"])
    assert info["containers"] == {
        "collector": "lab3_mon_collector",
        "tsdb": "lab3_mon_tsdb",
        "vmalert": "lab3_mon_vmalert",
        "grafana": "lab3_mon_grafana",
    }
    assert info["tsdb_url"] == "http://127.0.0.1:8428" and info["grafana_url"] == "http://127.0.0.1:3000"
    topology["monitoring"]["placement"] = "node"
    files = render.render_all(
        topology, plan.build(topology), {"collector": "10.0.0.5", "tsdb": "10.0.0.6", "grafana": "10.0.0.7"}
    )
    info = json.loads(files["stack.json"])
    assert info["containers"]["collector"] == "clab-lab3-mon-collector"
    assert info["tsdb_url"] == "http://10.0.0.6:8428" and info["grafana_url"] == "http://10.0.0.7:3000"


def test_dashboard_markers_are_toggles(topology):
    files = rendered(topology)
    routing = json.loads(files["grafana/dashboards/netlab-routing.json"])
    markers = {a["name"]: a for a in routing["annotations"]["list"]}
    assert markers["Link outages"]["enable"] and markers["Fault tests"]["enable"]
    # device-timestamp markers are opt-in, follow the node filter and sit at the device's time
    for name in ("SPF runs", "Neighbor changes"):
        assert markers[name]["enable"] is False and markers[name]["useValueForTime"]
        assert 'node=~"$node"' in markers[name]["expr"]
    overview = json.loads(files["grafana/dashboards/netlab-overview.json"])
    spf = next(a for a in overview["annotations"]["list"] if a["name"] == "SPF runs")
    assert "$node" not in spf["expr"]  # the overview has no node variable
    folded = [p for p in overview["panels"] if p["type"] == "row" and p["collapsed"]]
    assert [p["title"] for p in folded] == ["Topology graph"]
    assert folded[0]["panels"][0]["type"] == "nodeGraph"
