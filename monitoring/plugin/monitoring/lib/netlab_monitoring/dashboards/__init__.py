"""Grafana dashboards, generated so they stay consistent and use only canonical metrics.

Every query uses netlab_* metric names and netlab labels (node, ifname, link, peer_node),
so the same dashboards work for FRR, gNMI, SNMP and host-only nodes.

* ``panels``: the builders (``Board``, ``stat``, ``ts``, ``table``, ``q``) and shared queries;
  YAML dashboard specs (``spec.py``) are compiled with the same builders.
* ``overview``, ``routing``, ``node``, ``logs``: one module per built-in board. To add a board,
  write a function returning ``Board(...).build(...)`` and list it in ``build`` below.
"""

from __future__ import annotations

from . import logs, node, overview, routing


def build(plan: dict, cfg: dict | None = None) -> dict[str, dict]:
    """uid -> Grafana dashboard for every built-in board the lab's settings call for."""
    del plan  # dashboards are lab-independent (the lab is a variable)
    boards = {
        "netlab-overview": overview.overview(),
        "netlab-routing": routing.routing(),
        "netlab-node": node.node_detail(),
    }
    if ((cfg or {}).get("logs") or {}).get("enabled"):
        boards["netlab-logs"] = logs.logs()
    return boards
