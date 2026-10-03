"""Opt-in components: logs (Loki + Vector) and alert notifications (Alertmanager)."""

import json

import yaml
from netlab_monitoring import dashboards, logs, notify, plan, render

HOOK = "http://127.0.0.1:5001/hook"


def rendered(topology, **overrides):
    topology["monitoring"].update(overrides)
    return render.render_all(topology, plan.build(topology))


def test_logs_and_notifications_are_off_by_default(topology):
    files = rendered(topology)
    assert "loki/loki.yml" not in files and "vector/vector.yaml" not in files
    assert "alertmanager/alertmanager.yml" not in files
    assert "grafana/dashboards/netlab-logs.json" not in files
    assert "-notifier.blackhole" in files["up.sh"] and "--name lab3_mon_alertmanager" not in files["up.sh"]
    assert "loki" not in files["grafana/provisioning/datasources/netlab.yml"]
    info = json.loads(files["stack.json"])
    assert info["loki_url"] is None and info["alertmanager_url"] is None and info["syslog"] is None


def test_logs_add_loki_vector_and_a_dashboard(topology):
    files = rendered(topology, logs={"enabled": True, "retention": "72h"})
    up = files["up.sh"]
    assert "--name lab3_mon_loki" in up and "--name lab3_mon_vector" in up
    assert "monitoring/data/loki:/loki" in up and "/var/run/docker.sock" in up

    loki = yaml.safe_load(files["loki/loki.yml"])
    assert loki["limits_config"]["retention_period"] == "72h" and loki["server"]["http_listen_port"] == 3100

    vector = yaml.safe_load(files["vector/vector.yaml"])
    assert vector["sources"]["syslog"]["address"] == "0.0.0.0:1514"
    names = vector["sources"]["containers"]["include_containers"]
    assert names and all(n.startswith("clab-") for n in names)
    script = vector["transforms"]["netlab"]["source"]
    assert '"r1"' in script and "by_container" in script and "by_ip" in script
    assert vector["sinks"]["loki"]["endpoint"] == "http://127.0.0.1:3100"
    assert vector["sinks"]["loki"]["labels"]["lab"] == "lab3"

    sources = yaml.safe_load(files["grafana/provisioning/datasources/netlab.yml"])["datasources"]
    assert {d["uid"]: d["type"] for d in sources} == {"netlab": "prometheus", "netlab-logs": "loki"}
    board = json.loads(files["grafana/dashboards/netlab-logs.json"])
    assert [p["type"] for p in board["panels"]] == ["timeseries", "logs"]
    assert all(p["datasource"]["uid"] == "netlab-logs" for p in board["panels"])
    assert {v["name"] for v in board["templating"]["list"]} == {"lab", "node", "search"}
    info = json.loads(files["stack.json"])
    assert info["syslog"] == "udp/1514" and info["dashboards"]["logs"] == "netlab-logs"
    assert info["containers"]["loki"] == "lab3_mon_loki"


def test_syslog_sender_is_matched_by_management_address(topology):
    p = plan.build(topology)
    p["nodes"]["r1"]["mgmt"]["ipv4"] = "192.168.121.101/24"
    script = logs.vector_config(p, "127.0.0.1:3100", 1514)["transforms"]["netlab"]["source"]
    assert '"192.168.121.101": "r1"' in script  # prefix length is dropped


def test_multilab_offsets_the_new_ports(topology):
    topology.setdefault("defaults", {})["multilab"] = {"id": 2}
    files = rendered(topology, logs={"enabled": True}, alerts={"notify": {"webhook": HOOK}})
    assert yaml.safe_load(files["loki/loki.yml"])["server"]["http_listen_port"] == 3102
    assert "-notifier.url=http://127.0.0.1:9095" in files["up.sh"]
    assert "0.0.0.0:1516" in files["vector/vector.yaml"]


def test_notifications_start_alertmanager_and_route_vmalert_to_it(topology):
    files = rendered(topology, alerts={"notify": {"webhook": HOOK, "slack": "https://hooks.slack.com/services/x"}})
    up = files["up.sh"]
    assert "--name lab3_mon_alertmanager" in up
    assert "-notifier.url=http://127.0.0.1:9093" in up and "-notifier.blackhole" not in up
    config = yaml.safe_load(files["alertmanager/alertmanager.yml"])
    receiver = config["receivers"][0]
    assert receiver["webhook_configs"][0]["url"] == HOOK and receiver["slack_configs"]
    assert config["route"]["receiver"] == "netlab" and "email_configs" not in receiver
    assert json.loads(files["stack.json"])["alertmanager_url"] == "http://127.0.0.1:9093"


def test_email_notifications(topology):
    email = {
        "to": "ops@example.org",
        "from": "netlab@example.org",
        "smarthost": "smtp.example.org:587",
        "password": "p",
    }
    config = notify.alertmanager_config({"alerts": {"notify": {"email": email}}})
    assert config["receivers"][0]["email_configs"][0]["to"] == "ops@example.org"
    assert (
        config["global"]["smtp_smarthost"] == "smtp.example.org:587" and config["global"]["smtp_auth_password"] == "p"
    )


def test_notify_settings_are_checked():
    assert notify.problems({}) == []
    assert (
        notify.problems(
            {"alerts": {"notify": {"webhook": HOOK, "email": {"to": "a@b", "from": "c@d", "smarthost": "h:25"}}}}
        )
        == []
    )
    found = notify.problems({"alerts": {"notify": {"webhook": "ftp://x", "email": {"to": "a@b"}}}})
    assert any("webhook" in f for f in found) and any("from, smarthost" in f for f in found)
    assert not notify.enabled({"alerts": {"notify": {}}})


def test_node_placement_adds_the_components(topology):
    cfg = dict(topology["monitoring"], placement="node", logs={"enabled": True}, alerts={"notify": {"webhook": HOOK}})
    nodes = render.component_nodes(cfg, needs_gnmi=False, needs_snmp=False)
    assert {"mon-loki", "mon-vector", "mon-alertmanager"} <= set(nodes)
    assert "-notifier.url=http://mon-alertmanager:9093" in nodes["mon-vmalert"]["cmd"]
    assert nodes["mon-vector"]["ports"] == ["1514:1514/udp"]


def test_logs_dashboard_only_with_logs():
    assert "netlab-logs" not in dashboards.build({})
    assert "netlab-logs" in dashboards.build({}, {"logs": {"enabled": True}})
