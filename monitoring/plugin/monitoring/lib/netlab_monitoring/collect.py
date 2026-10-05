"""What the collectors scrape: the TSDB scrape config, and gNMI subscriptions via gnmic."""

from __future__ import annotations

import json
from pathlib import Path

from .endpoints import Endpoints, needs

PLUGIN_DIR = Path(__file__).resolve().parents[2]
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

# Paths per mapping, grouped by what they measure. Every group is its own gnmic subscription: a
# device rejects a whole subscription when one of its paths is unknown to its model (a NOS version
# that renamed a leaf, a protocol it lacks), and with a single subscription that took out the
# interfaces, BGP and OSPF too. Verified against SR Linux 26.3.2; the OpenConfig paths follow the
# OpenConfig models and have not been run against a device yet.
GNMI_PATHS = {
    "srlinux": {
        "interfaces": [
            "/interface[name=*]/statistics",
            "/interface[name=*]/oper-state",
        ],
        "bgp": [
            "/network-instance[name=*]/protocols/bgp/neighbor[peer-address=*]",
        ],
        "ospf": [
            "/network-instance[name=*]/protocols/ospf/instance[name=*]/area[area-id=*]"
            "/interface[interface-name=*]/neighbor[router-id=*]/adjacency-state",
            "/network-instance[name=*]/protocols/ospf/instance[name=*]/area[area-id=*]"
            "/interface[interface-name=*]/neighbor[router-id=*]/state-changes",
            "/network-instance[name=*]/protocols/ospf/instance[name=*]/area[area-id=*]"
            "/interface[interface-name=*]/neighbor[router-id=*]/last-event-time",
            "/network-instance[name=*]/protocols/ospf/instance[name=*]/area[area-id=*]/full-spf-runs",
            "/network-instance[name=*]/protocols/ospf/instance[name=*]/area[area-id=*]/last-spf-run-time",
        ],
        "isis": [
            "/network-instance[name=*]/protocols/isis/instance[name=*]/interface[interface-name=*]"
            "/adjacency[neighbor-system-id=*]/state",
            "/network-instance[name=*]/protocols/isis/instance[name=*]/interface[interface-name=*]"
            "/adjacency[neighbor-system-id=*]/up-down-transitions",
            "/network-instance[name=*]/protocols/isis/instance[name=*]/interface[interface-name=*]"
            "/adjacency[neighbor-system-id=*]/last-up-down-transition",
            "/network-instance[name=*]/protocols/isis/instance[name=*]/level[level-number=*]/statistics/spf-runs",
        ],
        "routes": [
            "/network-instance[name=*]/route-table/ipv4-unicast/statistics",
            "/network-instance[name=*]/route-table/ipv6-unicast/statistics",
        ],
    },
    "openconfig": {
        "interfaces": [
            "/interfaces/interface[name=*]/state/counters",
            "/interfaces/interface[name=*]/state/oper-status",
        ],
        "bgp": [
            "/network-instances/network-instance[name=*]/protocols/protocol[identifier=BGP][name=*]/bgp/neighbors"
            "/neighbor[neighbor-address=*]/state",
        ],
        "ospf": [
            "/network-instances/network-instance[name=*]/protocols/protocol[identifier=OSPF][name=*]/ospfv2/areas"
            "/area[identifier=*]/interfaces/interface[id=*]/neighbors/neighbor[router-id=*]/state/adjacency-state",
        ],
        "isis": [
            "/network-instances/network-instance[name=*]/protocols/protocol[identifier=ISIS][name=*]/isis/interfaces"
            "/interface[interface-id=*]/levels/level[level-number=*]/adjacencies/adjacency[system-id=*]"
            "/state/adjacency-state",
        ],
    },
}


def gnmi_subscriptions(mapping: str) -> dict[str, list[str]]:
    """Subscription name -> paths for a mapping, one subscription per group of paths."""
    groups = GNMI_PATHS.get(mapping, GNMI_PATHS["openconfig"])
    return {f"{mapping}-{group}": paths for group, paths in groups.items()}


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
            "subscriptions": list(gnmi_subscriptions(mapping)),
            "encoding": gnmi.get("encoding") or "json_ietf",
        }
        tls = gnmi.get("tls") or "skip-verify"
        target["insecure" if tls == "insecure" else "skip-verify"] = True
        targets[f"{address}:{gnmi.get('port') or 57400}"] = target
    subscriptions = {
        name: {"paths": paths, "mode": "stream", "stream-mode": "sample", "sample-interval": interval}
        for m in sorted(mappings)
        for name, paths in gnmi_subscriptions(m).items()
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
    # Keyed by the container's interface name (SR Linux "e1-1") and by the device's own ("ethernet-1/1"):
    # gNMI reports the latter, and without it no interface gets its link and peer labels.
    ifnames = {
        name: {
            key: {k: i[k] for k in ("ifname", "link", "peer_node", "peer_ifname") if i.get(k)}
            for i in node.get("interfaces", [])
            for key in dict.fromkeys(filter(None, (i["dev"], i.get("ifname"))))
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
