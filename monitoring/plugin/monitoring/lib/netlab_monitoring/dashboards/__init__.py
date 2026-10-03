"""Grafana dashboards: data files compiled to Grafana's JSON.

Every built-in board is a YAML file here, in the same format as the dashboards users write
(``spec.py`` documents it), so it can be read, reviewed and edited as plain data: rows of
panels with their queries. All queries use netlab_* metric names and netlab labels (node,
ifname, link, peer_node), so the same dashboards work for FRR, gNMI, SNMP and host-only nodes.

* ``overview.yml``, ``routing.yml``, ``node.yml``, ``logs.yml``: one file per board. To add a
  board, write a file and list it in ``BOARDS`` below.
* ``panels``: the renderer, which turns a panel description into Grafana's verbose JSON
  (``stat``, ``ts``, ``table``), plus what every board shares: the lab and node pickers, the
  Markers dropdown and its annotations, the links between dashboards.
"""

from __future__ import annotations

from pathlib import Path

import yaml

HERE = Path(__file__).parent

# uid -> file; logs only when the lab turns them on
BOARDS = {
    "netlab-overview": "overview.yml",
    "netlab-routing": "routing.yml",
    "netlab-node": "node.yml",
}
LOGS_BOARD = ("netlab-logs", "logs.yml")


def _compile(filename: str) -> dict:
    from .. import spec  # not at import time: spec imports this package's panels

    return spec.compile_spec(yaml.safe_load((HERE / filename).read_text(encoding="utf-8")), builtin=True)


def build(plan: dict, cfg: dict | None = None) -> dict[str, dict]:
    """uid -> Grafana dashboard for every built-in board the lab's settings call for."""
    del plan  # dashboards are lab-independent (the lab is a variable)
    wanted = dict(BOARDS)
    if ((cfg or {}).get("logs") or {}).get("enabled"):
        wanted[LOGS_BOARD[0]] = LOGS_BOARD[1]
    return {uid: _compile(filename) for uid, filename in wanted.items()}
