"""netlab monitoring plugin.

Adds vendor-independent monitoring to a lab: host-side metrics for every container and
libvirt VM, protocol state (FRR vty, gNMI, SNMP -- chosen per device from data profiles),
the intended state from the topology, VictoriaMetrics for storage and Grafana dashboards.

Use it with 'plugin: [ monitoring ]' (install the plugin in ~/.netlab/monitoring or next
to the topology). 'netlab create' writes <lab>/monitoring/, 'netlab up' starts the stack
(as the 'monitoring' external tool, or as lab nodes with 'monitoring.placement: node').
"""

from __future__ import annotations

import contextlib
import os
import sys
from pathlib import Path

from box import Box
from netsim import api
from netsim.data import append_to_list
from netsim.utils import log

_PLUGIN_DIR = Path(__file__).resolve().parent
if str(_PLUGIN_DIR / "lib") not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR / "lib"))

from netlab_monitoring import logs as _logs  # noqa: E402
from netlab_monitoring import notify as _notify  # noqa: E402
from netlab_monitoring import plan as _plan  # noqa: E402
from netlab_monitoring import render as _render  # noqa: E402
from netlab_monitoring import scope as _scope  # noqa: E402

_config_name = "monitoring"
_execute_after = ["fabric", "node.clone", "multilab"]
OUTPUT_DIR = "monitoring"


def _settings(topology: Box) -> Box:
    """Merge plugin defaults with the lab's 'monitoring' settings (lab values win)."""
    if not topology.get("_monitoring_merged"):
        topology.monitoring = topology.defaults.get("monitoring", Box({})) + topology.get("monitoring", Box({}))
        topology._monitoring_merged = True
    return topology.monitoring


def _needs(topology: Box, method: str) -> bool:
    profiles = topology.monitoring.get("profiles", {})
    for node in topology.nodes.values():
        device = node.get("device") or topology.defaults.get("device")
        if node.get("monitoring.method", _plan.resolve_profile(profiles, str(device)).get("method")) == method:
            return True
    return False


def topology_expand(topology: Box) -> None:
    """placement: node -- add the monitoring containers as clab nodes of the lab."""
    cfg = _settings(topology)
    if cfg.get("placement") != "node":
        return
    for name, clab in _render.component_nodes(cfg, _needs(topology, "gnmi"), _needs(topology, "snmp")).items():
        if name in topology.nodes:
            log.error(
                f"monitoring: node {name} already exists (change monitoring.node_prefix)",
                category=log.IncorrectValue,
                module="monitoring",
            )
            continue
        topology.nodes[name] = Box(
            {
                "name": name,
                "device": "linux",
                "provider": "clab",
                "module": [],
                "interfaces": [],
                "role": "host",
                "clab": clab,
                _plan.COMPONENT_FLAG: True,
            }
        )


def init(topology: Box) -> None:
    cfg = _settings(topology)
    for problem in _notify.problems(cfg):
        log.error(problem, category=log.IncorrectValue, module="monitoring")
    append_to_list(topology.defaults.netlab.create, "plugin", "monitoring")
    tool = topology.defaults.tools.monitoring
    if cfg.get("placement") == "node":
        tool.enabled = False  # the containers are lab nodes, nothing to start
        topology.get("tools", Box({})).pop("monitoring", None)
        if not topology.get("tools"):
            topology.pop("tools", None)
        return
    offset = int(topology.defaults.get("multilab.id", 0) or 0)
    grafana = int(cfg.ports.grafana) + offset
    tsdb = int(cfg.ports.tsdb) + offset
    tool.docker.message = (
        f"Monitoring: Grafana http://{{sys.ipurl}}:{grafana} "
        f"(metrics API http://{{sys.ipurl}}:{tsdb}, files in {OUTPUT_DIR}/)"
    )


def post_transform(topology: Box) -> None:
    """Check the node selection; attach the snippets that enable gNMI/SNMP on devices that need them."""
    cfg = topology.monitoring
    profiles = cfg.get("profiles", {})
    selection = _scope.resolve(topology)
    for problem in selection.errors:
        log.error(problem, category=log.IncorrectValue, module="monitoring")
    for note in selection.warnings:
        log.warning(text=note, module="monitoring")
    for name in selection.full:  # a host-only node is not logged into, so nothing is configured on it
        node = topology.nodes[name]
        profile = _plan.resolve_profile(profiles, str(node.device))
        if node.get("monitoring.method", profile.get("method")) in ("gnmi", "snmp") and profile.get("config"):
            api.node_config(node, _config_name)


def output(topology: Box) -> None:
    """netlab create: write <lab>/monitoring/ (plan, collector, TSDB, gnmic and Grafana files)."""
    plan = _plan.build(topology)
    component_ips = {}
    prefix = topology.monitoring.get("node_prefix", "mon")
    for name, node in topology.nodes.items():
        if node.get(_plan.COMPONENT_FLAG):
            component_ips[name.removeprefix(f"{prefix}-")] = node.get("mgmt.ipv4") or name
    files = _render.render_all(topology, plan, component_ips)
    root = Path(OUTPUT_DIR)
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        if rel.endswith(".sh"):
            path.chmod(0o755)
    # The user's own dashboards and alerts live next to the generated files and are never
    # overwritten: starter files are written only into a folder that has no such files yet.
    for rel, content in _render.seed_files().items():
        folder = (root / rel).parent
        if not any(folder.glob("*.yml" if rel.endswith(".yml") else "*.json")):
            folder.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(content)
    for data in ("tsdb", "grafana", *(("loki", "vector") if _logs.enabled(topology.monitoring) else ())):
        (root / "data" / data).mkdir(parents=True, exist_ok=True)
        with contextlib.suppress(OSError):
            os.chmod(root / "data" / data, 0o777)  # written by the container's own user
    counts: dict[str, int] = {}
    for node in plan["nodes"].values():
        for method in node["methods"]:
            counts[method] = counts.get(method, 0) + 1
    summary = ", ".join(f"{m}: {c}" for m, c in sorted(counts.items())) or "no nodes"
    log.info(text=f"Created {OUTPUT_DIR}/ for {len(plan['nodes'])} nodes ({summary})", module="monitoring")
    scope_info = plan["scope"]
    if scope_info["monitored"] != scope_info["total"] or scope_info["light"]:
        log.info(
            text=f"Monitoring {scope_info['monitored']} of {scope_info['total']} nodes"
            + (f", {scope_info['light']} of them host-only" if scope_info["light"] else ""),
            module="monitoring",
        )
    for note in _plan.experimental_notes(plan):
        log.info(text=f"Experimental: {note}", module="monitoring")
