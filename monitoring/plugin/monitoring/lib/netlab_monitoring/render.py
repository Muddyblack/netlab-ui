"""Render the monitoring stack configuration for one lab.

Everything goes into <lab>/monitoring/ so a lab directory is self-contained (it can be
copied, inspected, and its metrics survive 'netlab down').
"""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from . import alerts, catalog, logs, notify
from .collect import gnmic_config, gnmic_starlark, scrape_config
from .containers import ROLES, component_nodes, tool_scripts, tsdb_args
from .endpoints import DEFAULT_PORTS, Endpoints, endpoints, needs
from .grafana import USER_DASHBOARDS_MOUNT, grafana_env, grafana_files
from .plan import container_name, get

COLLECTOR_SRC = Path(__file__).resolve().parents[2] / "collector" / "nlmon"

__all__ = [
    "DEFAULT_PORTS",
    "ROLES",
    "USER_DASHBOARDS_MOUNT",
    "Endpoints",
    "component_nodes",
    "endpoints",
    "grafana_env",
    "grafana_files",
    "render_all",
    "seed_files",
    "tool_scripts",
    "tsdb_args",
]


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
    files["rules/netlab.yml"] = alerts.builtin_yaml()
    files["METRICS.md"] = metrics_reference()
    if logs.enabled(cfg):
        files["loki/loki.yml"] = yaml.safe_dump(logs.loki_config(cfg, ep.loki_port, ep.loki_grpc_port), sort_keys=False)
        files["vector/vector.yaml"] = yaml.safe_dump(logs.vector_config(plan, ep.loki, ep.syslog_port), sort_keys=False)
    if notify.enabled(cfg):
        files["alertmanager/alertmanager.yml"] = yaml.safe_dump(notify.alertmanager_config(cfg), sort_keys=False)
    if cfg.get("placement") == "node":
        files["up.sh"] = "#!/bin/bash\n# placement: node -- the monitoring containers are lab nodes\n"
        files["down.sh"] = files["up.sh"]
    else:
        files.update(tool_scripts(plan, cfg, ep))
    files["README.md"] = readme(plan, cfg, ep)
    files["stack.json"] = json.dumps(stack_info(topology, plan, cfg, ep), indent=1, sort_keys=True)
    return files


def metrics_reference() -> str:
    """monitoring/METRICS.md: every metric and label, for people (and assistants) writing queries."""
    labels = "\n".join(f"* `{name}`: {text}" for name, text in catalog.COMMON_LABELS.items())
    rows = "\n".join(f"| `{m['name']}` | {m['type']} | {m['help']} |" for m in catalog.listing())
    return f"""# Metrics

Generated from the collector. Every series carries the lab's own names, whatever device or
collection method produced it:

{labels}

Query them in Grafana (Explore) or at the TSDB's Prometheus API. Filter on `lab="$lab"` in
dashboards. Counters end in `_total`: use `rate(...[1m])`.

| Metric | Type | Meaning |
|---|---|---|
{rows}
"""


def seed_files() -> dict[str, str]:
    """Starter files for the user's own dashboards and alerts. Written only when the folder is empty."""
    return {
        "alerts/example.yml": alerts.EXAMPLE,
        "dashboards/README.md": (
            "Put Grafana dashboard JSON here (Grafana: Share > Export, or compile a YAML spec with\n"
            "`python -m netlab_monitoring.spec board.yml -o monitoring/dashboards/board.json`).\n"
            "They appear in the 'My dashboards' folder within ~10 seconds.\n"
        ),
    }


def stack_info(topology: dict, plan: dict, cfg: dict, ep: Endpoints) -> dict:
    """Where the running stack is, for tools that drive it (netlab-ui reads this file)."""
    roles = ["collector", "tsdb", "vmalert"]
    roles += ["alertmanager"] if notify.enabled(cfg) else []
    roles += ["loki", "vector"] if logs.enabled(cfg) else []
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
        "vmalert_url": f"http://{ep.vmalert}",
        "alertmanager_url": f"http://{ep.alertmanager}" if "alertmanager" in roles else None,
        "loki_url": f"http://{ep.loki}" if "loki" in roles else None,
        "syslog": f"udp/{ep.syslog_port}" if "vector" in roles else None,
        "user_dashboards_dir": "monitoring/dashboards",
        "user_alerts_dir": "monitoring/alerts",
        "tsdb_port": ep.tsdb_port,
        "grafana_port": ep.grafana_port if "grafana" in roles else None,
        "grafana_url": f"http://{ep.grafana}" if "grafana" in roles else None,
        "grafana_user": "admin",
        "grafana_password": str(get(cfg, "grafana.admin_password", "admin")),
        "dashboards": {
            "overview": "netlab-overview",
            "routing": "netlab-routing",
            "node": "netlab-node",
            **({"logs": "netlab-logs"} if "loki" in roles else {}),
        },
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
