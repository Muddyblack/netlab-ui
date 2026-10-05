"""Where each stack component listens, as seen by the others (host ports, or lab management IPs)."""

from __future__ import annotations

import typing

from .plan import get


class Endpoints(typing.NamedTuple):
    """Where the stack components listen, as seen by each other."""

    collector: str
    tsdb: str
    gnmic: str
    snmp: str
    grafana: str
    grafana_port: int
    tsdb_port: int
    vmalert: str = ""
    vmalert_port: int = 0
    loki: str = ""
    loki_port: int = 0
    loki_grpc_port: int = 0
    alertmanager: str = ""
    alertmanager_port: int = 0
    syslog_port: int = 0


# Used when a lab's own settings predate a component (older ~/.netlab.yml overrides, tests).
DEFAULT_PORTS = {"vmalert": 8880, "loki": 3100, "loki_grpc": 9096, "alertmanager": 9093, "syslog": 1514}


def endpoints(topology: dict, cfg: dict, component_ips: dict[str, str] | None = None) -> Endpoints:
    ports = {**DEFAULT_PORTS, **(cfg.get("ports") or {})}
    if cfg.get("placement") == "node":
        ips = component_ips or {}
        port = {k: int(v) for k, v in ports.items()}

        def addr(name: str) -> str:
            return f"{ips.get(name, name)}:{port[name]}"

    else:
        offset = int(get(topology, "defaults.multilab.id", 0) or 0)
        port = {k: int(v) + offset for k, v in ports.items()}

        def addr(name: str) -> str:
            return f"127.0.0.1:{port[name]}"

    return Endpoints(
        collector=addr("collector"),
        tsdb=addr("tsdb"),
        gnmic=addr("gnmic"),
        snmp=addr("snmp"),
        grafana=addr("grafana"),
        grafana_port=port["grafana"],
        tsdb_port=port["tsdb"],
        vmalert=addr("vmalert"),
        vmalert_port=port["vmalert"],
        loki=addr("loki"),
        loki_port=port["loki"],
        loki_grpc_port=port["loki_grpc"],
        alertmanager=addr("alertmanager"),
        alertmanager_port=port["alertmanager"],
        syslog_port=port["syslog"],
    )


def needs(plan: dict, method: str) -> bool:
    return any(method in n.get("methods", []) for n in plan["nodes"].values())
