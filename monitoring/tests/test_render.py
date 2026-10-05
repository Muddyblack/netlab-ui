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


def test_the_gnmi_mapping_only_emits_known_metrics():
    """A typo in the Starlark mapping would silently drop a metric (gnmic just exports the odd name)."""
    import re

    from netlab_monitoring import collect
    from nlmon.metrics import FAMILIES

    script = collect.GNMI_MAP.read_text()
    # names written out whole; the four BGP update/message counters are built from a prefix, so listed below
    emitted = set(re.findall(r'"(netlab_[a-z0-9_]*[a-z0-9])"', script)) | {
        f"netlab_bgp_{kind}_{direction}_total" for kind in ("updates", "messages") for direction in ("received", "sent")
    }
    assert emitted - set(FAMILIES) == set(), "the mapping emits metrics the collector does not define"
    # the dashboards' convergence panels need these from a gNMI node as much as from an FRR one
    assert {
        "netlab_ospf_spf_runs_total",
        "netlab_ospf_neighbor_changes_total",
        "netlab_isis_spf_runs_total",
        "netlab_bgp_session_dropped_total",
        "netlab_routes",
    } <= emitted


def test_gnmi_and_snmp_nodes_get_their_collectors(topology):
    topology["nodes"]["r3"]["device"] = "srlinux"
    topology["nodes"]["r3"]["interfaces"][0]["clab"] = {"name": "e1-1"}
    topology["nodes"]["r2"]["device"] = "iosv"
    files = rendered(topology)
    gnmic = yaml.safe_load(files["gnmic/gnmic.yml"])
    target = next(iter(gnmic["targets"].values()))
    assert target["name"] == "r3"
    # one subscription per group of paths: a device rejects a whole subscription for one path it does not know
    assert target["subscriptions"] == [
        "srlinux-interfaces",
        "srlinux-bgp",
        "srlinux-ospf",
        "srlinux-isis",
        "srlinux-routes",
    ]
    assert set(target["subscriptions"]) <= set(gnmic["subscriptions"])
    assert all(len(sub["paths"]) >= 1 for sub in gnmic["subscriptions"].values())
    # SR Linux's IS-IS adjacency leaf is "state"; "adjacency-state" does not exist there (checked on a device)
    assert gnmic["subscriptions"]["srlinux-isis"]["paths"][0].endswith("/adjacency[neighbor-system-id=*]/state")
    star = files["gnmic/netlab_map.star"]
    assert "INTERFACES" in star and '"e1-1"' in star
    # gNMI reports the device's own interface name, so the lookup table has that too (checked on SR Linux)
    ifname = topology["nodes"]["r3"]["interfaces"][0]["ifname"]
    assert f'"{ifname}"' in star
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


def test_dashboard_markers_are_picked_in_one_dropdown(topology):
    files = rendered(topology)
    routing = json.loads(files["grafana/dashboards/netlab-routing.json"])
    # every marker is always enabled and hidden from the controls bar; the Markers dropdown picks them
    markers = {a["name"]: a for a in routing["annotations"]["list"]}
    assert all(a["enable"] and a["hide"] for a in markers.values())
    dropdown = next(v for v in routing["templating"]["list"] if v["name"] == "markers")
    assert {o["value"]: o["selected"] for o in dropdown["options"]} == {
        "link": True,
        "scenario": True,
        "spf": False,
        "neighbor": False,
    }
    # device-timestamp markers follow the node filter, sit at the device's time and only show while picked
    for name, kind in (("🟦 SPF runs", "spf"), ("🟥 Neighbor changes", "neighbor")):
        assert markers[name]["useValueForTime"]
        assert 'node=~"$node"' in markers[name]["expr"]
        assert f".*{kind}.*" in markers[name]["expr"] and "${markers:csv}" in markers[name]["expr"]
    overview = json.loads(files["grafana/dashboards/netlab-overview.json"])
    spf = next(a for a in overview["annotations"]["list"] if a["name"] == "🟦 SPF runs")
    assert "$node" not in spf["expr"]  # the overview has no node variable
    folded = [p for p in overview["panels"] if p["type"] == "row" and p["collapsed"]]
    assert [p["title"] for p in folded] == ["Topology graph"]
    assert folded[0]["panels"][0]["type"] == "nodeGraph"


def _run(code):
    import subprocess
    import sys

    return subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=False)


def test_up_sh_stops_on_a_port_another_program_holds(topology):
    """Grafana in a restart loop under a "netlab up ... OK", and the UI opening another program on its port."""
    import socket

    from netlab_monitoring import containers

    up = rendered(topology)["up.sh"]
    check = up.split("NETLAB_PORT_CHECK\n")[1]
    assert "grafana" in check and "3000" in check and "8428" in check and "tsdb" in check
    assert up.index("NETLAB_PORT_CHECK") < up.index("docker run")  # before anything is started

    tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp.bind(("0.0.0.0", 0))
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.bind(("0.0.0.0", 0))
    try:
        taken, taken_udp = tcp.getsockname()[1], udp.getsockname()[1]
        result = _run(containers.port_check_code([("grafana", taken, "tcp"), ("syslog", taken_udp, "udp")]))
        assert result.returncode == 1
        assert f"port {taken} (grafana)" in result.stderr and "monitoring.ports.grafana" in result.stderr
        assert f"port {taken_udp} (syslog)" in result.stderr
    finally:
        tcp.close()
        udp.close()
    # free again: the check passes
    assert _run(containers.port_check_code([("grafana", taken, "tcp"), ("syslog", taken_udp, "udp")])).returncode == 0


def test_a_port_that_is_only_closing_does_not_read_as_taken():
    """Right after the stack is stopped its connections linger (TIME_WAIT). Nothing listens on the port, a server
    binds it fine, and so must the check, or restarting the stack would refuse to start it."""
    import socket

    from netlab_monitoring import containers

    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen()
    port = server.getsockname()[1]
    client = socket.create_connection(("127.0.0.1", port))
    connection, _ = server.accept()
    connection.close()  # the side that closes first keeps the port in TIME_WAIT
    client.close()
    server.close()
    check = containers.port_check_code([("grafana", port, "tcp")])
    result = _run(check)
    assert result.returncode == 0, result.stderr
    # while a server really listens on it, the check still says so
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("0.0.0.0", port))
    listener.listen()
    try:
        assert _run(check).returncode == 1
    finally:
        listener.close()


def test_the_port_check_covers_only_the_components_the_lab_runs(topology):
    plain = rendered(topology)["up.sh"]
    assert "loki" not in plain.split("NETLAB_PORT_CHECK")[1] and "syslog" not in plain.split("NETLAB_PORT_CHECK")[1]
    topology["monitoring"]["logs"] = {"enabled": True}
    with_logs = rendered(topology)["up.sh"].split("NETLAB_PORT_CHECK")[1]
    assert "loki" in with_logs and "syslog" in with_logs and "udp" in with_logs
