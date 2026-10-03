"""Compile a small YAML dashboard spec to a Grafana dashboard.

Users (and the netlab-ui assistant) describe a board in a few lines; the built-in
dashboards use the same panel builders, so a spec looks and behaves like them::

    title: BGP at a glance
    node_variable: true            # adds the $node picker
    rows:
      - title: Sessions
        panels:
          - { type: stat, title: Established, expr: 'sum(netlab_bgp_session_up{lab="$lab"})' }
          - type: timeseries
            title: Prefixes received
            unit: short
            queries:
              - { expr: 'netlab_bgp_prefixes_received{lab="$lab",node=~"$node"}', legend: '{{node}} {{peer}}' }

Always filter on ``lab="$lab"`` (and ``node=~"$node"`` with ``node_variable``) so the board
follows the lab picker. ``python -m netlab_monitoring.spec board.yml -o board.json`` compiles
one file; drop the JSON into ``<lab>/monitoring/dashboards/``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import typing
from pathlib import Path

import yaml

from . import catalog
from .dashboards import panels

PANEL_TYPES = ("stat", "timeseries", "table")
DEFAULT_SIZE = {"stat": (6, 4), "timeseries": (12, 8), "table": (24, 8)}


class SpecError(ValueError):
    """The spec is not a valid dashboard description (the message names the offending part)."""


def _queries(panel: dict, where: str) -> list[dict]:
    raw = panel.get("queries")
    if raw is None and panel.get("expr"):
        raw = [{"expr": panel["expr"], "legend": panel.get("legend", "")}]
    if not raw or not isinstance(raw, list):
        raise SpecError(f"{where}: needs 'expr' or a list of 'queries'")
    out = []
    for i, item in enumerate(raw):
        if isinstance(item, str):
            item = {"expr": item}
        if not isinstance(item, dict) or not item.get("expr"):
            raise SpecError(f"{where}: query {i + 1} needs an 'expr'")
        out.append(item)
    return out


def _thresholds(panel: dict, where: str) -> list[dict] | None:
    raw = panel.get("thresholds")
    if raw is None:
        return None
    if not isinstance(raw, list) or not raw:
        raise SpecError(f"{where}: 'thresholds' is a list like [{{color: red, value: 1}}]")
    steps: list[dict] = [{"color": "green", "value": None}]
    for item in raw:
        if not isinstance(item, dict) or "value" not in item:
            raise SpecError(f"{where}: each threshold needs 'value' (and optionally 'color')")
        steps.append({"color": item.get("color", "red"), "value": item["value"]})
    return steps


def _panel(panel: dict, where: str) -> tuple[dict, int, int]:
    kind = panel.get("type", "timeseries")
    if kind not in PANEL_TYPES:
        raise SpecError(f"{where}: type must be one of {', '.join(PANEL_TYPES)} (got {kind!r})")
    title = str(panel.get("title") or "")
    if not title:
        raise SpecError(f"{where}: needs a 'title'")
    desc = str(panel.get("description", ""))
    unit = str(panel.get("unit", "none"))
    queries = _queries(panel, where)
    w, h = DEFAULT_SIZE[kind]
    w, h = int(panel.get("width", w)), int(panel.get("height", h))
    if not 1 <= w <= 24:
        raise SpecError(f"{where}: width must be 1..24")
    if kind == "stat":
        built = panels.stat(title, queries[0]["expr"], desc, unit, _thresholds(panel, where))
    elif kind == "table":
        built = panels.table(title, [panels.q(x["expr"], instant=True, fmt="table") for x in queries], desc)
    else:
        targets = [panels.q(x["expr"], str(x.get("legend", ""))) for x in queries]
        built = panels.ts(title, targets, unit, desc, stack=bool(panel.get("stack")))
    return built, w, h


def compile_spec(spec: typing.Any) -> dict:
    """Validate a spec and return the Grafana dashboard. Raises SpecError."""
    if not isinstance(spec, dict):
        raise SpecError("the spec must be a mapping with 'title' and 'rows'")
    title = str(spec.get("title") or "")
    if not title:
        raise SpecError("needs a 'title'")
    uid = str(spec.get("uid") or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"))[:40]
    if uid.startswith("netlab-"):
        raise SpecError("uid must not start with 'netlab-' (reserved for the built-in dashboards)")
    rows = spec.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SpecError("needs a non-empty 'rows' list")
    board = panels.Board(uid, title, str(spec.get("description", "")))
    for r, row in enumerate(rows, 1):
        if not isinstance(row, dict) or not isinstance(row.get("panels"), list) or not row["panels"]:
            raise SpecError(f"row {r}: needs a 'panels' list")
        if row.get("title"):
            board.row(str(row["title"]))
        for p, panel in enumerate(row["panels"], 1):
            if not isinstance(panel, dict):
                raise SpecError(f"row {r} panel {p}: must be a mapping")
            built, w, h = _panel(panel, f"row {r} panel {p}")
            board.add(built, w, h)
    with_node = bool(spec.get("node_variable"))
    result = board.build(panels.variables(with_node, multi=True), panels.LINKS)
    result["tags"] = ["netlab", "user"]
    return result


def warnings(spec: typing.Any) -> list[str]:
    """Problems that do not stop compiling: unknown metrics, a missing lab filter."""
    found: list[str] = []
    for row in spec.get("rows", []) if isinstance(spec, dict) else []:
        for panel in row.get("panels", []):
            exprs = [x if isinstance(x, str) else x.get("expr", "") for x in panel.get("queries", [])]
            exprs.append(panel.get("expr", ""))
            for expr in filter(None, exprs):
                found += [f"{panel.get('title', '?')}: unknown metric {m}" for m in catalog.unknown_metrics(expr)]
                if "$lab" not in expr:
                    found.append(f'{panel.get("title", "?")}: no lab="$lab" filter, shows every lab')
    return found


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compile a YAML dashboard spec to Grafana JSON")
    ap.add_argument("spec", type=Path)
    ap.add_argument("-o", "--output", type=Path, help="write here (default: stdout)")
    args = ap.parse_args(argv)
    spec = yaml.safe_load(args.spec.read_text())
    try:
        board = compile_spec(spec)
    except SpecError as exc:
        print(f"{args.spec}: {exc}", file=sys.stderr)
        return 1
    for line in warnings(spec):
        print(f"warning: {line}", file=sys.stderr)
    text = json.dumps(board, indent=1)
    if args.output:
        args.output.write_text(text)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
