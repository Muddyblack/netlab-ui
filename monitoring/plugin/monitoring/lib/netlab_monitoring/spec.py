"""Compile a small YAML dashboard spec to a Grafana dashboard.

Users (and the netlab-ui assistant) describe a board in a few lines, and the built-in
dashboards (``dashboards/*.yml``) are written in the same format and compiled by the same
code, so a spec looks and behaves like them::

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

Board options: ``title``, ``description``, ``uid``, ``node_variable`` (``true``: pick several
nodes, ``single``: pick one), ``macros`` (``NAME: text``, used as ``@NAME@`` in any query).
Row options: ``title``, ``collapsed`` (folded shut, one panel).
Panel types and their options (besides ``title``, ``description``, ``width``, ``height``):

* ``stat``: ``expr``, ``unit``, ``thresholds``, ``color_mode``, ``no_value``
* ``timeseries``: ``expr`` or ``queries``, ``unit``, ``stack``, ``legend_mode`` (``table``)
* ``table``: ``queries``, ``rename`` (column names), ``hide`` (columns), ``no_value``,
  ``overrides`` (a column coloured with a state mapping, ``{field: State, colors: up_down}``, or
  any Grafana field override)
* ``topology``: the lab as a node graph; ``logs``: Loki log lines (needs ``logs.enabled``)
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import typing
from pathlib import Path

import yaml

from . import catalog
from .dashboards import panels

PANEL_TYPES = ("stat", "timeseries", "table", "logs", "topology")
DEFAULT_SIZE = {"stat": (6, 4), "timeseries": (12, 8), "table": (24, 8), "logs": (24, 8), "topology": (24, 12)}
_MACRO = re.compile(r"@([A-Za-z_][A-Za-z0-9_]*)@")


class SpecError(ValueError):
    """The spec is not a valid dashboard description (the message names the offending part)."""


BOARD_KEYS = {"title", "description", "uid", "node_variable", "search_variable", "macros", "rows"}
ROW_KEYS = {"title", "collapsed", "panels"}
QUERY_KEYS = {"expr", "legend"}
_COMMON_KEYS = {"type", "title", "description", "width", "height"}
_QUERY_SOURCE_KEYS = {"expr", "legend", "queries"}
PANEL_KEYS = {
    "stat": _COMMON_KEYS | _QUERY_SOURCE_KEYS | {"unit", "thresholds", "color_mode", "no_value"},
    "timeseries": _COMMON_KEYS | _QUERY_SOURCE_KEYS | {"unit", "stack", "legend_mode", "datasource"},
    "table": _COMMON_KEYS | _QUERY_SOURCE_KEYS | {"rename", "hide", "mappings", "overrides", "no_value"},
    "logs": _COMMON_KEYS | _QUERY_SOURCE_KEYS,
    "topology": _COMMON_KEYS,
}


def _check_keys(item: dict, allowed: set[str], where: str) -> None:
    """Reject an option nobody reads: a typo like ``untis`` must not silently do nothing."""
    for key in item:
        if key not in allowed:
            close = difflib.get_close_matches(str(key), sorted(allowed), n=1)
            hint = f" (did you mean '{close[0]}'?)" if close else ""
            raise SpecError(f"{where}: unknown option '{key}'{hint}; allowed: {', '.join(sorted(allowed))}")


def _expand(text: str, macros: dict[str, str], where: str) -> str:
    """Replace ``@NAME@`` with the board's macro of that name."""

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in macros:
            raise SpecError(f"{where}: unknown macro @{name}@ (define it under 'macros')")
        return macros[name]

    return _MACRO.sub(replace, text)


def _queries(panel: dict, where: str, macros: dict[str, str]) -> list[dict]:
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
        _check_keys(item, QUERY_KEYS, f"{where} query {i + 1}")
        out.append({**item, "expr": _expand(str(item["expr"]), macros, where)})
    return out


def _thresholds(panel: dict, where: str) -> list[dict] | None:
    raw = panel.get("thresholds")
    if raw is None:
        return None
    if not isinstance(raw, list) or not raw:
        raise SpecError(f"{where}: 'thresholds' is a list like [{{color: red, value: 1}}]")
    for item in raw:
        if not isinstance(item, dict) or "value" not in item:
            raise SpecError(f"{where}: each threshold needs 'value' (and optionally 'color')")
    steps = [{"color": item.get("color", "red"), "value": item["value"]} for item in raw]
    # A first step without a value is the base colour; otherwise the base is green.
    return steps if steps[0]["value"] is None else [{"color": "green", "value": None}, *steps]


def _overrides(panel: dict, where: str) -> list[dict] | None:
    raw = panel.get("overrides")
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise SpecError(f"{where}: 'overrides' is a list")
    out = []
    for item in raw:
        if isinstance(item, dict) and "colors" in item:
            if item["colors"] not in panels.MAPPINGS or not item.get("field"):
                raise SpecError(f"{where}: colors needs a field and one of {', '.join(panels.MAPPINGS)}")
            out.append(panels.color_cell(str(item["field"]), panels.MAPPINGS[item["colors"]]))
        elif isinstance(item, dict) and "matcher" in item:
            out.append(item)
        else:
            raise SpecError(f"{where}: an override is {{field, colors}} or a Grafana override with a 'matcher'")
    return out


def _panel(panel: dict, where: str, macros: dict[str, str]) -> tuple[dict, int, int]:
    kind = panel.get("type", "timeseries")
    if kind not in PANEL_TYPES:
        raise SpecError(f"{where}: type must be one of {', '.join(PANEL_TYPES)} (got {kind!r})")
    _check_keys(panel, PANEL_KEYS[kind], f"{where} ({kind})")
    title = str(panel.get("title") or "")
    if not title and kind != "topology":  # the topology graph is titled by its builder
        raise SpecError(f"{where}: needs a 'title'")
    desc = str(panel.get("description", ""))
    unit = str(panel.get("unit", "none"))
    w, h = DEFAULT_SIZE[kind]
    w, h = int(panel.get("width", w)), int(panel.get("height", h))
    if not 1 <= w <= 24:
        raise SpecError(f"{where}: width must be 1..24")
    if kind == "topology":
        return panels.node_graph(), w, h
    queries = _queries(panel, where, macros)
    if kind == "logs":
        return panels.logs_panel(title, queries[0]["expr"]), w, h
    if kind == "stat":
        built = panels.stat(
            title,
            queries[0]["expr"],
            desc,
            unit,
            _thresholds(panel, where),
            color_mode=str(panel.get("color_mode", "value")),
            no_value=str(panel.get("no_value", "0")),
        )
    elif kind == "table":
        mappings = panels.MAPPINGS.get(str(panel.get("mappings"))) if panel.get("mappings") else None
        built = panels.table(
            title,
            [panels.q(x["expr"], instant=True, fmt="table") for x in queries],
            desc,
            rename=panel.get("rename"),
            hide=panel.get("hide"),
            mappings=mappings,
            overrides=_overrides(panel, where),
            no_value=str(panel.get("no_value", "")),
        )
    else:
        targets = [panels.q(x["expr"], str(x.get("legend", ""))) for x in queries]
        built = panels.ts(
            title,
            targets,
            unit,
            desc,
            stack=bool(panel.get("stack")),
            legend=str(panel.get("legend_mode", "list")),
        )
        if panel.get("datasource") == "loki":
            panels.use_loki(built)
    return built, w, h


def compile_spec(spec: typing.Any, *, builtin: bool = False) -> dict:
    """Validate a spec and return the Grafana dashboard. Raises SpecError.

    ``builtin`` is for the dashboards shipped with the plugin: they may use the reserved
    ``netlab-`` uids and are tagged as the plugin's, not the user's."""
    if not isinstance(spec, dict):
        raise SpecError("the spec must be a mapping with 'title' and 'rows'")
    _check_keys(spec, BOARD_KEYS, "the board")
    title = str(spec.get("title") or "")
    if not title:
        raise SpecError("needs a 'title'")
    uid = str(spec.get("uid") or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"))[:40]
    if uid.startswith("netlab-") and not builtin:
        raise SpecError("uid must not start with 'netlab-' (reserved for the built-in dashboards)")
    rows = spec.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SpecError("needs a non-empty 'rows' list")
    macros = {str(k): str(v) for k, v in (spec.get("macros") or {}).items()}
    board = panels.Board(uid, title, str(spec.get("description", "")))
    for r, row in enumerate(rows, 1):
        if not isinstance(row, dict) or not isinstance(row.get("panels"), list) or not row["panels"]:
            raise SpecError(f"row {r}: needs a 'panels' list")
        _check_keys(row, ROW_KEYS, f"row {r}")
        built_panels = []
        for p, panel in enumerate(row["panels"], 1):
            if not isinstance(panel, dict):
                raise SpecError(f"row {r} panel {p}: must be a mapping")
            built_panels.append(_panel(panel, f"row {r} panel {p}", macros))
        if row.get("collapsed"):
            if len(built_panels) != 1 or not row.get("title"):
                raise SpecError(f"row {r}: a collapsed row needs a 'title' and exactly one panel")
            built, _w, h = built_panels[0]
            board.collapsed_row(str(row["title"]), built, h)
            continue
        if row.get("title"):
            board.row(str(row["title"]))
        for built, w, h in built_panels:
            board.add(built, w, h)
    node_variable = spec.get("node_variable")
    variables = panels.variables(bool(node_variable), multi=node_variable != "single")
    if spec.get("search_variable"):
        variables.append(panels.search_variable())
    result = board.build(variables, panels.LINKS)
    if not builtin:
        result["tags"] = ["netlab", "user"]
    return result


def warnings(spec: typing.Any) -> list[str]:
    """Problems that do not stop compiling: unknown metrics, a missing lab filter."""
    found: list[str] = []
    macros = {str(k): str(v) for k, v in ((spec or {}).get("macros") or {}).items()} if isinstance(spec, dict) else {}
    for row in spec.get("rows", []) if isinstance(spec, dict) else []:
        for panel in row.get("panels", []):
            exprs = [x if isinstance(x, str) else x.get("expr", "") for x in panel.get("queries", [])]
            exprs.append(panel.get("expr", ""))
            for expr in filter(None, exprs):
                expr = _MACRO.sub(lambda m: macros.get(m.group(1), ""), expr)
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
