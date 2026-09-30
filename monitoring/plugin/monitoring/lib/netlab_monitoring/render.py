"""Render the monitoring stack configuration for one lab.

Everything goes into <lab>/monitoring/ so a lab directory is self-contained (it can be
copied, inspected, and its metrics survive 'netlab down').
"""

from __future__ import annotations

import json
import shlex
import typing
from pathlib import Path

import yaml

from . import dashboards
from .plan import container_name, get

PLUGIN_DIR = Path(__file__).resolve().parents[2]
COLLECTOR_SRC = PLUGIN_DIR / "collector" / "nlmon"
GNMI_MAP = PLUGIN_DIR / "gnmi" / "netlab_map.star"

# Canonical names for snmp_exporter's if_mib module
SNMP_RENAMES = {
    "ifHCInOctets": "netlab_if_rx_bytes_total",
    "ifHCOutOctets": "netlab_if_tx_bytes_total",
    "ifHCInUcastPkts": "netlab_if_rx_packets_total",
    "ifHCOutUcastPkts": "netlab_if_tx_packets_total",
    "ifInErrors": "netlab_if_rx_errors_total",
    "ifOutErrors": "netlab_if_tx_errors_total",
    "ifInDiscards": "netlab_if_rx_drops_total",
    "ifOutDiscards": "netlab_if_tx_drops_total",
}


class Endpoints(typing.NamedTuple):
    """Where the stack components listen, as seen by each other."""

    collector: str
    tsdb: str
    gnmic: str
    snmp: str
    grafana: str
    grafana_port: int
    tsdb_port: int


def endpoints(topology: dict, cfg: dict, component_ips: dict[str, str] | None = None) -> Endpoints:
    ports = cfg.get("ports") or {}
    if cfg.get("placement") == "node":
        ips = component_ips or {}

        def at(name: str, port: int) -> str:
            return f"{ips.get(name, name)}:{port}"

        return Endpoints(
            at("collector", ports["collector"]),
            at("tsdb", ports["tsdb"]),
            at("gnmic", ports["gnmic"]),
            at("snmp", ports["snmp"]),
            at("grafana", ports["grafana"]),
            ports["grafana"],
            ports["tsdb"],
        )
    offset = int(get(topology, "defaults.multilab.id", 0) or 0)
    p = {k: int(v) + offset for k, v in ports.items()}
    return Endpoints(
        f"127.0.0.1:{p['collector']}",
        f"127.0.0.1:{p['tsdb']}",
        f"127.0.0.1:{p['gnmic']}",
        f"127.0.0.1:{p['snmp']}",
        f"127.0.0.1:{p['grafana']}",
        p["grafana"],
        p["tsdb"],
    )


def needs(plan: dict, method: str) -> bool:
    return any(method in n.get("methods", []) for n in plan["nodes"].values())


# ------------------------------------------------------------------ TSDB scrape config


def scrape_config(plan: dict, cfg: dict, ep: Endpoints) -> dict:
    interval = f"{int(cfg.get('interval') or 15)}s"
    lab = plan["lab"]
    jobs: list[dict] = [
        {
            "job_name": "netlab",
            "honor_labels": True,
            "static_configs": [{"targets": [ep.collector]}],
        }
    ]
    if needs(plan, "gnmi"):
        jobs.append({"job_name": "gnmi", "honor_labels": True, "static_configs": [{"targets": [ep.gnmic]}]})
    snmp_nodes = {n: d for n, d in plan["nodes"].items() if "snmp" in d.get("methods", [])}
    if snmp_nodes:
        targets = []
        relabels: list[dict] = []
        for name, node in snmp_nodes.items():
            address = node["mgmt"].get("ipv4") or node["mgmt"].get("ipv6")
            if not address:
                continue
            targets.append({"targets": [address], "labels": {"node": name, "lab": lab}})
            for intf in node.get("interfaces", []):
                for label in ("link", "peer_node", "peer_ifname"):
                    if intf.get(label):
                        relabels.append(
                            {
                                "source_labels": ["node", "ifname"],
                                "regex": f"{name};{intf['ifname']}",
                                "target_label": label,
                                "replacement": intf[label],
                            }
                        )
        metric_relabels = [
            {"source_labels": ["__name__"], "regex": "|".join(SNMP_RENAMES), "action": "keep"},
            *(
                {"source_labels": ["__name__"], "regex": src, "target_label": "__name__", "replacement": dst}
                for src, dst in SNMP_RENAMES.items()
            ),
            {"source_labels": ["ifName"], "target_label": "ifname"},
            {"regex": "ifName|ifIndex|ifDescr|ifAlias", "action": "labeldrop"},
            *relabels,
        ]
        jobs.append(
            {
                "job_name": "snmp",
                "metrics_path": "/snmp",
                "params": {"module": ["if_mib"], "auth": ["public_v2"]},
                "static_configs": targets,
                "relabel_configs": [
                    {"source_labels": ["__address__"], "target_label": "__param_target"},
                    {"target_label": "__address__", "replacement": ep.snmp},
                ],
                "metric_relabel_configs": metric_relabels,
            }
        )
    for exp in plan.get("exporters", []):
        jobs.append(
            {
                "job_name": f"{exp['job']}-{exp['node']}",
                "metrics_path": exp["path"],
                "static_configs": [{"targets": [exp["target"]], "labels": {"node": exp["node"], "lab": lab}}],
            }
        )
    return {"global": {"scrape_interval": interval, "scrape_timeout": interval}, "scrape_configs": jobs}


# ------------------------------------------------------------------ gnmic

GNMI_PATHS = {
    "srlinux": [
        "/interface[name=*]/statistics",
        "/interface[name=*]/oper-state",
        "/network-instance[name=*]/protocols/bgp/neighbor[peer-address=*]",
        "/network-instance[name=*]/protocols/ospf/instance[name=*]/area[area-id=*]/interface[interface-name=*]"
        "/neighbor[router-id=*]/adjacency-state",
        "/network-instance[name=*]/protocols/isis/instance[name=*]/interface[interface-name=*]"
        "/adjacency[neighbor-system-id=*]/adjacency-state",
    ],
    "openconfig": [
        "/interfaces/interface[name=*]/state/counters",
        "/interfaces/interface[name=*]/state/oper-status",
        "/network-instances/network-instance[name=*]/protocols/protocol[identifier=BGP][name=*]/bgp/neighbors"
        "/neighbor[neighbor-address=*]/state",
        "/network-instances/network-instance[name=*]/protocols/protocol[identifier=OSPF][name=*]/ospfv2/areas"
        "/area[identifier=*]/interfaces/interface[id=*]/neighbors/neighbor[router-id=*]/state/adjacency-state",
        "/network-instances/network-instance[name=*]/protocols/protocol[identifier=ISIS][name=*]/isis/interfaces"
        "/interface[interface-id=*]/levels/level[level-number=*]/adjacencies/adjacency[system-id=*]/state/adjacency-state",
    ],
}


def gnmic_config(plan: dict, cfg: dict, ep: Endpoints) -> dict:
    interval = f"{int(cfg.get('interval') or 15)}s"
    targets: dict[str, dict] = {}
    mappings: set[str] = set()
    for name, node in plan["nodes"].items():
        if "gnmi" not in node.get("methods", []):
            continue
        gnmi = node.get("gnmi") or {}
        address = node["mgmt"].get("ipv4") or node["mgmt"].get("ipv6")
        if not address:
            continue
        mapping = gnmi.get("mapping") or "openconfig"
        mappings.add(mapping)
        target = {
            "name": name,
            "username": gnmi.get("username"),
            "password": gnmi.get("password"),
            "subscriptions": [f"{mapping}"],
            "encoding": gnmi.get("encoding") or "json_ietf",
        }
        tls = gnmi.get("tls") or "skip-verify"
        target["insecure" if tls == "insecure" else "skip-verify"] = True
        targets[f"{address}:{gnmi.get('port') or 57400}"] = target
    subscriptions = {
        m: {
            "paths": GNMI_PATHS.get(m, GNMI_PATHS["openconfig"]),
            "mode": "stream",
            "stream-mode": "sample",
            "sample-interval": interval,
        }
        for m in sorted(mappings)
    }
    return {
        "log": True,
        "targets": targets,
        "subscriptions": subscriptions,
        "outputs": {
            "netlab": {
                "type": "prometheus",
                "listen": ep.gnmic,
                "path": "/metrics",
                "expiration": f"{int(cfg.get('interval') or 15) * 4}s",
                "metric-prefix": "",
                "append-subscription-name": False,
                "export-timestamps": False,
                "event-processors": ["netlab-map"],
            }
        },
        "processors": {"netlab-map": {"event-starlark": {"script": "/monitoring/gnmic/netlab_map.star"}}},
    }


def gnmic_starlark(plan: dict) -> str:
    """The mapping script with this lab's naming data prepended."""
    ifnames = {
        name: {
            i["dev"]: {k: i[k] for k in ("ifname", "link", "peer_node", "peer_ifname") if i.get(k)}
            for i in node.get("interfaces", [])
        }
        for name, node in plan["nodes"].items()
        if "gnmi" in node.get("methods", [])
    }
    header = (
        "# Generated by the netlab monitoring plugin -- lab data for the mapping below\n"
        f"LAB = {json.dumps(plan['lab'])}\n"
        f"ADDRESSES = {json.dumps(plan['addresses'], sort_keys=True)}\n"
        f"ROUTER_IDS = {json.dumps(plan['router_ids'], sort_keys=True)}\n"
        f"INTERFACES = {json.dumps(ifnames, sort_keys=True)}\n\n"
    )
    return header + GNMI_MAP.read_text()


# ------------------------------------------------------------------ Grafana


def grafana_files(plan: dict, cfg: dict, ep: Endpoints) -> dict[str, str]:
    datasource = {
        "apiVersion": 1,
        "datasources": [
            {
                "name": "netlab",
                "uid": "netlab",
                "type": "prometheus",
                "access": "proxy",
                "url": f"http://{ep.tsdb}",
                "isDefault": True,
                "editable": False,
                "jsonData": {"timeInterval": f"{int(cfg.get('interval') or 15)}s"},
            }
        ],
    }
    provider = {
        "apiVersion": 1,
        "providers": [
            {
                "name": "netlab",
                "folder": "netlab",
                "type": "file",
                "disableDeletion": True,
                "allowUiUpdates": False,
                "options": {"path": "/etc/netlab-dashboards", "foldersFromFilesStructure": False},
            }
        ],
    }
    files = {
        "grafana/provisioning/datasources/netlab.yml": yaml.safe_dump(datasource, sort_keys=False),
        "grafana/provisioning/dashboards/netlab.yml": yaml.safe_dump(provider, sort_keys=False),
    }
    for name, board in dashboards.build(plan).items():
        files[f"grafana/dashboards/{name}.json"] = json.dumps(board, indent=1)
    return files


def grafana_env(cfg: dict, port: int) -> dict[str, str]:
    gcfg = cfg.get("grafana") or {}
    return {
        "GF_SERVER_HTTP_PORT": str(port),
        "GF_AUTH_ANONYMOUS_ENABLED": "true",
        "GF_AUTH_ANONYMOUS_ORG_ROLE": str(gcfg.get("anonymous_role") or "Viewer"),
        "GF_SECURITY_ADMIN_PASSWORD": str(gcfg.get("admin_password") or "admin"),
        "GF_SECURITY_ALLOW_EMBEDDING": "true",
        "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH": "/etc/netlab-dashboards/netlab-overview.json",
        "GF_ANALYTICS_REPORTING_ENABLED": "false",
        "GF_ANALYTICS_CHECK_FOR_UPDATES": "false",
        "GF_NEWS_NEWS_FEED_ENABLED": "false",
        "GF_USERS_DEFAULT_THEME": "system",
    }


def tsdb_args(cfg: dict, listen_port: int, config_path: str, storage: str) -> list[str]:
    return [
        f"-storageDataPath={storage}",
        f"-retentionPeriod={cfg.get('retention') or '7d'}",
        f"-httpListenAddr=:{listen_port}",
        f"-promscrape.config={config_path}",
        "-search.latencyOffset=2s",  # show fresh samples right away (lab, not a WAN)
        "-promscrape.config.strictParse=false",
    ]


# ------------------------------------------------------------------ tool placement scripts


def _container(name: str, image: str, args: list[str], opts: list[str], lab: str, role: str) -> str:
    cmd = [
        "docker",
        "run",
        "-d",
        "--name",
        name,
        "--restart",
        "unless-stopped",
        "--network",
        "host",
        "--label",
        f"netlab.lab={lab}",
        "--label",
        f"netlab.monitoring={role}",
        *opts,
        image,
        *args,
    ]
    return " ".join(shlex.quote(c) if not c.startswith('"$') else c for c in cmd)


def tool_scripts(plan: dict, cfg: dict, ep: Endpoints) -> dict[str, str]:
    lab = plan["lab"]
    images = cfg.get("images") or {}
    names = {role: f"{lab}_mon_{role}" for role in ("collector", "tsdb", "grafana", "gnmic", "snmp")}
    uses_libvirt = any(n.get("provider") == "libvirt" for n in plan["nodes"].values())
    collector_port = ep.collector.rsplit(":", 1)[1]
    lines = [
        "#!/bin/bash",
        "# Generated by the netlab monitoring plugin: start the monitoring stack (netlab up runs this)",
        "set -e",
        'cd "$(dirname "$0")/.."',
        f"docker rm -f {' '.join(names.values())} >/dev/null 2>&1 || true",
        "mkdir -p monitoring/data/tsdb",
        _container(
            names["collector"],
            images.get("collector", "python:3.13-alpine"),
            [
                "python3",
                "-m",
                "nlmon",
                "--plan",
                "/monitoring/plan.json",
                "--listen",
                f"127.0.0.1:{collector_port}",
                "--proc",
                "/proc",
                "--sys",
                "/host/sys",
            ],
            [
                "--pid",
                "host",
                "--cgroupns",
                "host",
                "--privileged",
                "-e",
                "PYTHONPATH=/monitoring/collector",
                "-v",
                "/sys:/host/sys:ro",
                "-v",
                "/var/run/docker.sock:/var/run/docker.sock:ro",
                *(["-v", "/run/libvirt:/run/libvirt:ro"] if uses_libvirt else []),
                "-v",
                '"$PWD/monitoring:/monitoring:ro"',
            ],
            lab,
            "collector",
        ),
        _container(
            names["tsdb"],
            images.get("tsdb", "victoriametrics/victoria-metrics"),
            tsdb_args(cfg, ep.tsdb_port, "/monitoring/tsdb/scrape.yml", "/storage"),
            ["-v", '"$PWD/monitoring:/monitoring:ro"', "-v", '"$PWD/monitoring/data/tsdb:/storage"'],
            lab,
            "tsdb",
        ),
    ]
    if needs(plan, "gnmi"):
        lines.append(
            _container(
                names["gnmic"],
                images.get("gnmic", "ghcr.io/openconfig/gnmic"),
                ["subscribe", "--config", "/monitoring/gnmic/gnmic.yml"],
                ["-v", '"$PWD/monitoring:/monitoring:ro"'],
                lab,
                "gnmic",
            )
        )
    if needs(plan, "snmp"):
        snmp_port = ep.snmp.rsplit(":", 1)[1]
        lines.append(
            _container(
                names["snmp"],
                images.get("snmp", "prom/snmp-exporter"),
                [f"--web.listen-address=127.0.0.1:{snmp_port}"],
                [],
                lab,
                "snmp",
            )
        )
    if get(cfg, "grafana.enabled", True):
        env = [x for k, v in grafana_env(cfg, ep.grafana_port).items() for x in ("-e", f"{k}={v}")]
        lines.append(
            _container(
                names["grafana"],
                images.get("grafana", "grafana/grafana"),
                [],
                [
                    *env,
                    "-v",
                    '"$PWD/monitoring/grafana/provisioning:/etc/grafana/provisioning:ro"',
                    "-v",
                    '"$PWD/monitoring/grafana/dashboards:/etc/netlab-dashboards:ro"',
                ],
                lab,
                "grafana",
            )
        )
    down = [
        "#!/bin/bash",
        "# Generated by the netlab monitoring plugin: stop the monitoring stack (metrics stay in monitoring/data)",
        f"docker rm -f {' '.join(names.values())} >/dev/null 2>&1 || true",
    ]
    return {"up.sh": "\n".join(lines) + "\n", "down.sh": "\n".join(down) + "\n"}


# ------------------------------------------------------------------ node placement


def component_nodes(cfg: dict, needs_gnmi: bool, needs_snmp: bool) -> dict[str, dict]:
    """Monitoring containers as netlab nodes (placement: node). Paths are relative to the lab."""
    images = cfg.get("images") or {}
    ports = cfg.get("ports") or {}
    prefix = cfg.get("node_prefix") or "mon"
    nodes: dict[str, dict] = {
        f"{prefix}-collector": {
            "image": images.get("collector", "python:3.13-alpine"),
            "cmd": f"python3 -m nlmon --plan /monitoring/plan.json --listen :{ports['collector']}",
            "env": {"PYTHONPATH": "/monitoring/collector"},
            "binds": [
                "monitoring:/monitoring:ro",
                "/proc:/host/proc:ro",
                "/sys:/host/sys:ro",
                "/var/run/docker.sock:/var/run/docker.sock:ro",
            ],
        },
        f"{prefix}-tsdb": {
            "image": images.get("tsdb", "victoriametrics/victoria-metrics"),
            "cmd": " ".join(tsdb_args(cfg, ports["tsdb"], "/monitoring/tsdb/scrape.yml", "/storage")),
            "binds": ["monitoring:/monitoring:ro", "monitoring/data/tsdb:/storage"],
            "ports": [f"{ports['tsdb']}:{ports['tsdb']}"],
        },
    }
    if needs_gnmi:
        nodes[f"{prefix}-gnmic"] = {
            "image": images.get("gnmic", "ghcr.io/openconfig/gnmic"),
            "cmd": "subscribe --config /monitoring/gnmic/gnmic.yml",
            "binds": ["monitoring:/monitoring:ro"],
        }
    if needs_snmp:
        nodes[f"{prefix}-snmp"] = {
            "image": images.get("snmp", "prom/snmp-exporter"),
            "cmd": f"--web.listen-address=:{ports['snmp']}",
        }
    if get(cfg, "grafana.enabled", True):
        nodes[f"{prefix}-grafana"] = {
            "image": images.get("grafana", "grafana/grafana"),
            "env": grafana_env(cfg, ports["grafana"]),
            "binds": [
                "monitoring/grafana/provisioning:/etc/grafana/provisioning:ro",
                "monitoring/grafana/dashboards:/etc/netlab-dashboards:ro",
            ],
            "ports": [f"{ports['grafana']}:{ports['grafana']}"],
        }
    return nodes


# ------------------------------------------------------------------ everything


def render_all(topology: dict, plan: dict, component_ips: dict[str, str] | None = None) -> dict[str, str]:
    cfg = topology.get("monitoring") or {}
    ep = endpoints(topology, cfg, component_ips)
    files: dict[str, str] = {
        "plan.json": json.dumps(plan, indent=1, sort_keys=True),
        "tsdb/scrape.yml": yaml.safe_dump(scrape_config(plan, cfg, ep), sort_keys=False),
    }
    for src in sorted(COLLECTOR_SRC.glob("*.py")):
        files[f"collector/nlmon/{src.name}"] = src.read_text()
    if needs(plan, "gnmi"):
        files["gnmic/gnmic.yml"] = yaml.safe_dump(gnmic_config(plan, cfg, ep), sort_keys=False)
        files["gnmic/netlab_map.star"] = gnmic_starlark(plan)
    files.update(grafana_files(plan, cfg, ep))
    if cfg.get("placement") == "node":
        files["up.sh"] = "#!/bin/bash\n# placement: node -- the monitoring containers are lab nodes\n"
        files["down.sh"] = files["up.sh"]
    else:
        files.update(tool_scripts(plan, cfg, ep))
    files["README.md"] = readme(plan, cfg, ep)
    files["stack.json"] = json.dumps(stack_info(topology, plan, cfg, ep), indent=1, sort_keys=True)
    return files


def stack_info(topology: dict, plan: dict, cfg: dict, ep: Endpoints) -> dict:
    """Where the running stack is, for tools that drive it (netlab-ui reads this file)."""
    roles = ["collector", "tsdb"]
    roles += [r for r in ("gnmic", "snmp") if needs(plan, "gnmi" if r == "gnmic" else r)]
    if get(cfg, "grafana.enabled", True):
        roles.append("grafana")
    if cfg.get("placement") == "node":
        prefix = cfg.get("node_prefix") or "mon"
        containers = {r: container_name(topology, f"{prefix}-{r}") for r in roles}
    else:
        containers = {r: f"{plan['lab']}_mon_{r}" for r in roles}
    return {
        "lab": plan["lab"],
        "placement": cfg.get("placement") or "tool",
        "interval": int(cfg.get("interval") or 15),
        "containers": containers,
        "tsdb_url": f"http://{ep.tsdb}",
        "collector_url": f"http://{ep.collector}",
        "tsdb_port": ep.tsdb_port,
        "grafana_port": ep.grafana_port if "grafana" in roles else None,
        "grafana_url": f"http://{ep.grafana}" if "grafana" in roles else None,
        "grafana_user": "admin",
        "grafana_password": str(get(cfg, "grafana.admin_password", "admin")),
        "dashboards": {"overview": "netlab-overview", "routing": "netlab-routing", "node": "netlab-node"},
    }


def readme(plan: dict, cfg: dict, ep: Endpoints) -> str:
    methods: dict[str, list[str]] = {}
    for name, node in plan["nodes"].items():
        methods.setdefault("+".join(node.get("methods") or ["none"]), []).append(name)
    rows = "\n".join(f"| {m} | {', '.join(sorted(n))} |" for m, n in sorted(methods.items()))
    return f"""# Monitoring for lab {plan["lab"]}

Generated by the netlab `monitoring` plugin -- edit the topology, not these files.

* Grafana: http://<host>:{ep.grafana_port}  (dashboards in the "netlab" folder)
* Metrics (Prometheus API, VictoriaMetrics): http://<host>:{ep.tsdb_port}
* Placement: {cfg.get("placement", "tool")}, collection interval {cfg.get("interval", 15)}s,
  retention {cfg.get("retention", "7d")}. Metrics are stored in `monitoring/data` and survive `netlab down`.

| Collection | Nodes |
|---|---|
{rows}
"""
