"""User extension points: metric catalog, YAML dashboard specs, alert rules, vmalert wiring."""

import json

import pytest
import yaml
from netlab_monitoring import alerts, catalog, plan, render, spec

GOOD = {
    "title": "BGP at a glance",
    "node_variable": True,
    "rows": [
        {
            "title": "Sessions",
            "panels": [
                {"type": "stat", "title": "Up", "expr": 'sum(netlab_bgp_session_up{lab="$lab"})'},
                {
                    "title": "Prefixes",
                    "unit": "short",
                    "queries": [{"expr": 'netlab_bgp_session_up{lab="$lab",node=~"$node"}', "legend": "{{node}}"}],
                },
            ],
        }
    ],
}


def rendered(topology):
    return render.render_all(topology, plan.build(topology))


def test_catalog_lists_every_collector_metric():
    names = {m["name"] for m in catalog.listing()}
    assert {"netlab_bgp_session_up", "netlab_if_rx_bytes_total", "netlab_node_up"} <= names
    assert [m["name"] for m in catalog.listing("ospf")] and all("ospf" in m["name"] for m in catalog.listing("ospf"))


def test_builtin_boards_are_yaml_files_that_all_compile():
    from pathlib import Path

    from netlab_monitoring import dashboards

    files = sorted(p.name for p in Path(dashboards.__file__).parent.glob("*.yml"))
    registered = [*dashboards.BOARDS.values(), dashboards.LOGS_BOARD[1]]
    assert files == sorted(registered), "every dashboard file must be registered in dashboards.BOARDS"
    boards = dashboards.build({}, {"logs": {"enabled": True}})
    assert set(boards) == {*dashboards.BOARDS, dashboards.LOGS_BOARD[0]}
    assert set(dashboards.build({}, {})) == set(dashboards.BOARDS)  # logs only when turned on
    for uid, board in boards.items():
        assert board["uid"] == uid and board["tags"] == ["netlab"]
        json.dumps(board)
    # the built-in boards are held to the same rules as user boards: only known metrics, followed lab filter
    for filename in registered:
        board_spec = yaml.safe_load((Path(dashboards.__file__).parent / filename).read_text(encoding="utf-8"))
        assert [w for w in spec.warnings(board_spec) if "unknown metric" in w] == [], filename


def test_spec_macros_collapsed_rows_and_colored_cells():
    board = spec.compile_spec(
        {
            "title": "Macros",
            "macros": {"SEL": 'lab="$lab"'},
            "rows": [
                {
                    "title": "Table",
                    "panels": [
                        {
                            "type": "table",
                            "title": "Sessions",
                            "queries": ["netlab_bgp_session_up{@SEL@}"],
                            "rename": {"node": "Node", "Value": "State"},
                            "overrides": [{"field": "State", "colors": "up_down"}],
                        }
                    ],
                },
                {"title": "Folded", "collapsed": True, "panels": [{"type": "topology"}]},
            ],
        }
    )
    table = board["panels"][1]
    assert table["targets"][0]["expr"] == '(netlab_bgp_session_up{lab="$lab"}) + 0'
    assert table["fieldConfig"]["overrides"][0]["matcher"]["options"] == "State"
    folded = board["panels"][2]
    assert folded["collapsed"] and folded["panels"][0]["type"] == "nodeGraph"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"rows": [{"panels": [{"type": "stat", "title": "x", "expr": "up{@NOPE@}"}]}]}, "unknown macro @NOPE@"),
        (
            {"rows": [{"title": "R", "collapsed": True, "panels": [{"title": "a", "expr": "x"}] * 2}]},
            "exactly one panel",
        ),
        (
            {
                "rows": [
                    {
                        "panels": [
                            {
                                "type": "table",
                                "title": "t",
                                "queries": ["x"],
                                "overrides": [{"field": "A", "colors": "?"}],
                            }
                        ]
                    }
                ]
            },
            "colors needs a field",
        ),
    ],
)
def test_spec_extension_errors_name_the_problem(change, message):
    with pytest.raises(spec.SpecError, match=message):
        spec.compile_spec({"title": "Bad", **change})


def _board(**panel):
    return {"title": "T", "rows": [{"panels": [{"type": "stat", "title": "x", "expr": "up", **panel}]}]}


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        (_board(untis="bytes"), r"unknown option 'untis' \(did you mean 'unit'\?\)"),
        (
            {**_board(), "node_variabel": True},
            r"the board: unknown option 'node_variabel' \(did you mean 'node_variable'",
        ),
        (
            {"title": "T", "rows": [{"titel": "R", "panels": [{"title": "x", "expr": "up"}]}]},
            "row 1: unknown option 'titel'",
        ),
        (_board(rename={"a": "b"}), r"\(stat\): unknown option 'rename'"),  # a table option on a stat
        ({"title": "T", "rows": [{"panels": [{"title": "x", "queries": [{"expr": "up", "lenged": "a"}]}]}]}, "query 1"),
    ],
)
def test_unknown_options_are_errors_not_silently_ignored(bad, message):
    with pytest.raises(spec.SpecError, match=message):
        spec.compile_spec(bad)


def test_unknown_metrics_are_found():
    assert catalog.unknown_metrics('netlab_node_up{lab="x"} + netlab_nope') == ["netlab_nope"]
    assert catalog.unknown_metrics("rate(netlab_if_rx_bytes_total[1m])") == []


def test_spec_compiles_to_a_grafana_dashboard():
    board = spec.compile_spec(GOOD)
    assert board["uid"] == "bgp-at-a-glance" and board["tags"] == ["netlab", "user"]
    assert [p["type"] for p in board["panels"]] == ["row", "stat", "timeseries"]
    # the lab and node pickers, and the Markers dropdown with its hidden helper variables
    assert {v["name"] for v in board["templating"]["list"]} == {
        "lab",
        "node",
        "markers",
        "marker_link",
        "marker_scenario",
    }
    json.dumps(board)  # serializable
    assert spec.warnings(GOOD) == []


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"title": ""}, "title"),
        ({"rows": []}, "rows"),
        ({"uid": "netlab-mine"}, "reserved"),
        ({"rows": [{"panels": [{"title": "x", "type": "pie", "expr": "up"}]}]}, "type must be"),
        ({"rows": [{"panels": [{"title": "x"}]}]}, "expr"),
        ({"rows": [{"panels": [{"title": "x", "expr": "up", "width": 40}]}]}, "width"),
    ],
)
def test_spec_errors_name_the_problem(change, message):
    with pytest.raises(spec.SpecError, match=message):
        spec.compile_spec({**GOOD, **change})


def test_spec_warns_about_unknown_metrics_and_missing_lab_filter():
    found = spec.warnings({"rows": [{"panels": [{"title": "t", "expr": "netlab_typo"}]}]})
    assert any("unknown metric netlab_typo" in w for w in found)
    assert any("$lab" in w for w in found)


def _exprs(node):
    """Every PromQL/LogQL expression anywhere inside a dashboard (panels, variables, annotations)."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("expr", "query", "definition") and isinstance(value, str):
                yield value
            else:
                yield from _exprs(value)
    elif isinstance(node, list):
        for item in node:
            yield from _exprs(item)


def test_builtin_dashboards_only_use_metrics_the_collector_exports():
    from netlab_monitoring import dashboards

    boards = dashboards.build({}, {"logs": {"enabled": True}})
    assert set(boards) == {"netlab-overview", "netlab-routing", "netlab-node", "netlab-logs"}
    assert sum(1 for board in boards.values() for _ in _exprs(board)) > 50  # the walk really finds the queries
    unknown = {
        (uid, name) for uid, board in boards.items() for expr in _exprs(board) for name in catalog.unknown_metrics(expr)
    }
    assert unknown == set(), "dashboards use metrics missing from collector/nlmon/metrics.py FAMILIES"


def test_builtin_rules_are_valid_and_use_real_metrics():
    errors, warns = alerts.check(alerts.builtin_yaml())
    assert errors == [] and warns == []
    assert alerts.check(alerts.EXAMPLE) == ([], [])


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("a: [", "not valid YAML"),
        ("foo: 1", "groups"),
        ("groups: [{name: g, rules: [{expr: up}]}]", "alert"),
        ("groups: [{name: g, rules: [{alert: A}]}]", "expr"),
    ],
)
def test_rule_errors(text, message):
    errors, _ = alerts.check(text)
    assert any(message in e for e in errors)


def test_rule_warns_on_unknown_metric():
    _, warns = alerts.check("groups: [{name: g, rules: [{alert: A, expr: netlab_typo > 1}]}]")
    assert any("netlab_typo" in w for w in warns)


def test_stack_runs_vmalert_and_user_dashboards(topology):
    files = rendered(topology)
    up = files["up.sh"]
    assert "--name lab3_mon_vmalert" in up
    assert "-rule=/monitoring/alerts/*.yml" in up and "-notifier.blackhole" in up
    assert "monitoring/dashboards:/etc/netlab-user-dashboards:ro" in up
    assert "monitoring/data/grafana:/var/lib/grafana" in up
    assert "rules/netlab.yml" in files and "NetlabBgpSessionDown" in files["rules/netlab.yml"]
    provider = yaml.safe_load(files["grafana/provisioning/dashboards/netlab.yml"])["providers"]
    mine = next(p for p in provider if p["name"] == "my-dashboards")
    assert mine["allowUiUpdates"] is True and mine["folder"] == "My dashboards"
    builtin = next(p for p in provider if p["name"] == "netlab")
    assert builtin["allowUiUpdates"] is False  # the built-in boards stay read-only
    assert "netlab_bgp_session_up" in files["METRICS.md"]
    info = json.loads(files["stack.json"])
    assert info["containers"]["vmalert"] == "lab3_mon_vmalert" and info["vmalert_url"].endswith(":8880")


def test_node_placement_has_vmalert_node(topology):
    topology["monitoring"]["placement"] = "node"
    nodes = render.component_nodes(topology["monitoring"], False, False)
    assert "-datasource.url=http://mon-tsdb:" in nodes["mon-vmalert"]["cmd"]


def test_seed_files_are_valid():
    seeds = render.seed_files()
    assert alerts.check(seeds["alerts/example.yml"]) == ([], [])
