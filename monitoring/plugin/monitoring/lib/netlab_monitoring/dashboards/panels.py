"""Panel builders and the queries shared by the dashboards (and by YAML dashboard specs)."""

from __future__ import annotations

import typing

DS = {"type": "prometheus", "uid": "netlab"}
LAB = 'lab="$lab"'
NODE = 'lab="$lab",node=~"$node"'

# Expected-but-missing sessions: the topology says they should exist, they are not up.
MISSING_BGP = f"netlab_expected_bgp_session{{{LAB}}} unless on(lab,node,peer,vrf) (netlab_bgp_session_up{{{LAB}}} == 1)"
MISSING_OSPF = (
    f"netlab_expected_ospf_adjacency{{{LAB}}} unless on(lab,node,peer_node,ifname) "
    f"(netlab_ospf_neighbor_up{{{LAB}}} == 1)"
)
MISSING_ISIS = (
    f"netlab_expected_isis_adjacency{{{LAB}}} unless on(lab,node,peer_node,ifname) "
    f"(netlab_isis_adjacency_up{{{LAB}}} == 1)"
)


# The markers on the graphs: (value, label in the Markers dropdown, picked by default).
# Colours are the annotations' below (orange, purple, blue, red).
MARKERS = [
    ("link", "🟧 Link outages", True),
    ("scenario", "🟪 Fault tests", True),
    ("spf", "🟦 SPF runs", False),
    ("neighbor", "🟥 Neighbor changes", False),
]


class Board:
    def __init__(self, uid: str, title: str, description: str) -> None:
        self.uid, self.title, self.description = uid, title, description
        self.panels: list[dict] = []
        self.y = 0
        self.x = 0
        self.row_height = 0
        self.next_id = 1

    def _place(self, w: int, h: int) -> dict:
        if self.x + w > 24:
            self.x, self.y = 0, self.y + self.row_height
            self.row_height = 0
        pos = {"x": self.x, "y": self.y, "w": w, "h": h}
        self.x += w
        self.row_height = max(self.row_height, h)
        return pos

    def collapsed_row(self, title: str, panel: dict, h: int) -> None:
        """A row folded shut at the end of the board, holding one full-width panel."""
        self.row(title)
        row = self.panels[-1]
        self.add(panel, 24, h)
        row["panels"] = [self.panels.pop()]
        row["collapsed"] = True

    def row(self, title: str) -> None:
        if self.x:
            self.x, self.y = 0, self.y + self.row_height
        self.panels.append(
            {
                "type": "row",
                "title": title,
                "id": self._id(),
                "collapsed": False,
                "gridPos": {"x": 0, "y": self.y, "w": 24, "h": 1},
                "panels": [],
            }
        )
        self.y += 1
        self.row_height = 0

    def _id(self) -> int:
        self.next_id += 1
        return self.next_id

    def add(self, panel: dict, w: int, h: int) -> None:
        panel.setdefault("datasource", DS)
        panel.update({"id": self._id(), "gridPos": self._place(w, h)})
        for i, target in enumerate(panel.get("targets", [])):
            target.setdefault("refId", chr(65 + i))
            target.setdefault("datasource", DS)
        self.panels.append(panel)


    def build(self, variables: list[dict], links: list[dict]) -> dict:
        return {
            "uid": self.uid,
            "title": self.title,
            "description": self.description,
            "tags": ["netlab"],
            "timezone": "browser",
            "editable": True,
            "graphTooltip": 1,
            "refresh": "15s",
            "time": {"from": "now-30m", "to": "now"},
            "schemaVersion": 39,
            "templating": {"list": [*variables, *marker_variables()]},
            "links": links,
            "panels": self.panels,
            # Events netlab-ui marks on the dashboards, and the devices' own timestamps.
            # All are on and hidden from the controls bar: the Markers dropdown picks them,
            # one control instead of four toggles that wrap the bar in a narrow window.
            # A link down/up pair shows as one shaded region (the outage).
            "annotations": {
                "list": [
                    events("🟧 Link outages", "link", "rgba(255, 152, 48, 0.4)"),
                    events("🟪 Fault tests", "scenario", "rgba(184, 119, 217, 0.4)"),
                    *device_markers(any(v.get("name") == "node" for v in variables)),
                ]
            },
        }


def marker_variables() -> list[dict]:
    """The Markers dropdown, plus one hidden variable per netlab-ui event kind that is
    its tag while picked and "off" (a tag nothing carries) otherwise: Grafana's tag
    annotations cannot test a multi-value variable any other way."""
    result: list[dict] = [
        {
            "name": "markers",
            "label": "Markers",
            "type": "custom",
            "multi": True,
            "includeAll": False,
            "query": ", ".join(f"{label} : {value}" for value, label, _on in MARKERS),
            "options": [{"text": label, "value": value, "selected": on} for value, label, on in MARKERS],
            "current": {
                "text": [label for _value, label, on in MARKERS if on],
                "value": [value for value, _label, on in MARKERS if on],
            },
        }
    ]
    for tag in ("link", "scenario"):
        expr = f'label_replace(label_set(vector(1), "t", "${{markers:csv}}", "x", "off"), "x", "{tag}", "t", ".*{tag}.*")'
        result.append(
            {
                "name": f"marker_{tag}",
                "type": "query",
                "hide": 2,
                "datasource": DS,
                "refresh": 1,
                "query": {"query": f"query_result({expr})", "refId": f"marker_{tag}"},
                "definition": f"query_result({expr})",
                "regex": '/x="([^"]+)"/',
            }
        )
    return result


def picked(marker: str) -> str:
    """MetricsQL suffix that keeps a query's result only while `marker` is picked in Markers."""
    return f' and on() label_match(label_set(vector(1), "m", "${{markers:csv}}"), "m", ".*{marker}.*")'


def device_markers(node_filter: bool) -> list[dict]:
    """Markers from the devices' own timestamps (off by default in the Markers dropdown):
    when each router ran SPF, and when a neighbor/session last changed. Grafana places
    each at the time the value says (the series value is the timestamp), and a value
    repeated scrape after scrape is one marker."""
    sel = f'{LAB},node=~"$node"' if node_filter else LAB

    def when(metric: str, by: str, proto: str) -> str:
        return f'label_replace(round(max by ({by}) ({metric}{{{sel}}})) * 1000, "proto", "{proto}", "", "")'

    def marker(name: str, color: str, expr: str, title: str, kind: str) -> dict:
        return {
            "datasource": DS,
            "enable": True,
            "hide": True,
            "iconColor": color,
            "name": name,
            "expr": f"({expr}){picked(kind)}",
            "step": "$__interval",
            "useValueForTime": True,
            "titleFormat": title,
            "tagKeys": "proto,node",
        }

    spf = " or ".join(
        [
            when("netlab_ospf_spf_last_run_timestamp_seconds", "node", "OSPF"),
            when("netlab_isis_spf_last_run_timestamp_seconds", "node, level", "IS-IS"),
        ]
    )
    neighbors = " or ".join(
        [
            when("netlab_ospf_neighbor_last_change_timestamp_seconds", "node, peer_node, ifname", "OSPF"),
            when("netlab_isis_adjacency_last_change_timestamp_seconds", "node, peer_node, ifname", "IS-IS"),
            when("netlab_bgp_session_last_change_timestamp_seconds", "node, peer_node, peer", "BGP"),
        ]
    )
    return [
        marker("🟦 SPF runs", "rgba(87, 148, 242, 0.7)", spf, "{{proto}} SPF on {{node}}", "spf"),
        marker("🟥 Neighbor changes", "rgba(242, 73, 92, 0.7)", neighbors, "{{proto}} {{node}} - {{peer_node}} changed", "neighbor"),
    ]


def events(name: str, tag: str, color: str) -> dict:
    """Events netlab-ui posts with the tags `netlab` and `tag`, shown while `tag` is picked
    in the Markers dropdown (`$marker_<tag>` is the tag then, "off" otherwise)."""
    return {
        "datasource": {"type": "grafana", "uid": "-- Grafana --"},
        "enable": True,
        "hide": True,
        "iconColor": color,
        "name": name,
        "target": {"type": "tags", "tags": ["netlab", f"$marker_{tag}"], "limit": 200, "matchAny": False},
    }


def q(expr: str, legend: str = "", instant: bool = False, fmt: str | None = None) -> dict:
    target: dict[str, typing.Any] = {"expr": expr, "legendFormat": legend}
    if instant:
        target.update({"instant": True, "range": False})
    if fmt:
        target["format"] = fmt
    return target


def stat(
    title: str,
    expr: str,
    description: str = "",
    unit: str = "none",
    thresholds: list | None = None,
    color_mode: str = "value",
    no_value: str = "0",
) -> dict:
    return {
        "type": "stat",
        "title": title,
        "description": description,
        "targets": [q(expr, instant=True)],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "values": False},
            "colorMode": color_mode,
            "graphMode": "none",
            "textMode": "value",
            "justifyMode": "center",
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "noValue": no_value,
                "thresholds": {"mode": "absolute", "steps": thresholds or [{"color": "blue", "value": None}]},
            },
            "overrides": [],
        },
    }


def ts(
    title: str,
    targets: list[dict],
    unit: str = "none",
    description: str = "",
    stack: bool = False,
    legend: str = "list",
) -> dict:
    return {
        "type": "timeseries",
        "title": title,
        "description": description,
        "targets": targets,
        "options": {
            "legend": {
                "displayMode": legend,
                "placement": "bottom" if legend == "list" else "right",
                "calcs": [] if legend == "list" else ["lastNotNull", "max"],
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "custom": {
                    "lineWidth": 1,
                    "fillOpacity": 12,
                    "showPoints": "never",
                    "spanNulls": True,
                    "stacking": {"mode": "normal" if stack else "none"},
                },
            },
            "overrides": [],
        },
    }


def table(
    title: str,
    targets: list[dict],
    description: str = "",
    rename: dict | None = None,
    hide: list[str] | None = None,
    mappings: list | None = None,
    overrides: list | None = None,
    no_value: str = "",
) -> dict:
    hidden = dict.fromkeys(["Time", "__name__", "lab", "job", "instance", *(hide or [])], True)
    for target in targets:
        # Arithmetic drops the metric name, so rows of different metrics merge on their labels
        target["expr"] = f"({target['expr']}) + 0"
    return {
        "type": "table",
        "title": title,
        "description": description,
        "targets": targets,
        "options": {"showHeader": True, "cellHeight": "sm", "footer": {"show": False}},
        "fieldConfig": {
            "defaults": {
                "mappings": mappings or [],
                "custom": {"align": "auto"},
                **({"noValue": no_value} if no_value else {}),
            },
            "overrides": overrides or [],
        },
        "transformations": [
            {"id": "merge", "options": {}},
            {"id": "organize", "options": {"excludeByName": hidden, "renameByName": rename or {}}},
        ],
    }


def node_graph() -> dict:
    """The lab as a graph: nodes ringed green when up and red when down, links labelled with traffic."""
    nodes = (
        f'label_replace(label_replace(max by (node) (netlab_node_up{{{LAB}}}), "id", "$1", "node", "(.*)"),'
        ' "title", "$1", "node", "(.*)")'
    )
    traffic = (
        f"sum by (link) (rate(netlab_if_rx_bytes_total{{{LAB}}}[$__rate_interval]) + "
        f"rate(netlab_if_tx_bytes_total{{{LAB}}}[$__rate_interval])) * 4"
    )
    edges = (
        "label_replace(label_replace(label_replace("
        f'max by (link, a_node, b_node) (netlab_link_info{{{LAB},b_node!=""}}),'
        ' "id", "$1", "link", "(.*)"), "source", "$1", "a_node", "(.*)"), "target", "$1", "b_node", "(.*)")'
        f" * on(link) group_left() ({traffic})"
    )

    def copy(ref: str, alias: str, binary: dict | None = None) -> dict:
        # nodeGraph finds fields by their real name (id, title, mainstat, arc__*, source, target),
        # and a rename only changes the display name -- calculateField creates properly named fields
        options: dict = {"alias": alias}
        if binary:
            options |= {"mode": "binary", "binary": binary}
        else:
            options |= {"mode": "reduceRow", "reduce": {"include": [f"Value #{ref}"], "reducer": "last"}}
        return {"id": "calculateField", "options": options, "filter": {"id": "byRefId", "options": ref}}

    def fixed(name: str, color: str) -> dict:
        return {
            "matcher": {"id": "byName", "options": name},
            "properties": [
                {"id": "color", "value": {"mode": "fixed", "fixedColor": color}},
                {"id": "displayName", "value": name.removeprefix("arc__")},
            ],
        }

    return {
        "type": "nodeGraph",
        "title": "Topology",
        "description": "Nodes: ring green when up, red when down. Links: current traffic (both directions).",
        "targets": [q(nodes, instant=True, fmt="table"), q(edges, instant=True, fmt="table")],
        "transformations": [
            copy("A", "arc__up"),
            copy(
                "A",
                "arc__down",
                {
                    "left": {"fixed": "1"},
                    "operator": "-",
                    "right": {"matcher": {"id": "byName", "options": "Value #A"}},
                },
            ),
            copy("B", "mainstat"),
            {
                "id": "organize",
                "options": {
                    "excludeByName": dict.fromkeys(
                        ("Time", "node", "link", "a_node", "b_node", "Value #A", "Value #B"), True
                    )
                },
            },
        ],
        "fieldConfig": {
            "defaults": {},
            "overrides": [
                {"matcher": {"id": "byFrameRefID", "options": "B"}, "properties": [{"id": "unit", "value": "bps"}]},
                fixed("arc__up", "green"),
                fixed("arc__down", "red"),
            ],
        },
        "options": {
            "nodes": {
                "arcs": [{"field": "arc__up", "color": "green"}, {"field": "arc__down", "color": "red"}],
            },
            "edges": {"mainStatUnit": "bps"},
        },
    }


UP_DOWN = [
    {
        "type": "value",
        "options": {
            "1": {"text": "up", "color": "green", "index": 0},
            "0": {"text": "down", "color": "red", "index": 1},
        },
    }
]
BGP_STATE = [
    {
        "type": "value",
        "options": {
            str(v): {"text": t, "color": "green" if v == 6 else "red", "index": v}
            for v, t in enumerate(["unknown", "Idle", "Connect", "Active", "OpenSent", "OpenConfirm", "Established"])
        },
    }
]
OSPF_STATE = [
    {
        "type": "value",
        "options": {
            str(v): {"text": t, "color": "green" if v >= 8 else ("yellow" if v == 4 else "red"), "index": v}
            for v, t in enumerate(
                ["unknown", "Down", "Attempt", "Init", "2-Way", "ExStart", "Exchange", "Loading", "Full"]
            )
        },
    }
]


def color_cell(field: str, mappings: list) -> dict:
    return {
        "matcher": {"id": "byName", "options": field},
        "properties": [
            {"id": "mappings", "value": mappings},
            {"id": "custom.minWidth", "value": 110},
            {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "basic"}},
        ],
    }


def variables(with_node: bool, multi: bool) -> list[dict]:
    result = [
        {
            "name": "lab",
            "label": "Lab",
            "type": "query",
            "datasource": DS,
            "refresh": 2,
            "sort": 1,
            "query": {"query": "label_values(netlab_node_info, lab)", "refId": "lab"},
            "definition": "label_values(netlab_node_info, lab)",
        }
    ]
    if with_node:
        result.append(
            {
                "name": "node",
                "label": "Node",
                "type": "query",
                "datasource": DS,
                "refresh": 2,
                "sort": 1,
                "multi": multi,
                "includeAll": multi,
                "allValue": ".*",
                "query": {"query": 'label_values(netlab_node_info{lab="$lab"}, node)', "refId": "node"},
                "definition": 'label_values(netlab_node_info{lab="$lab"}, node)',
            }
        )
    return result


LINKS = [
    {
        "type": "dashboards",
        "tags": ["netlab"],
        # One dropdown, not a button per other dashboard: the controls bar then looks the
        # same on every dashboard and wraps less in a narrow tab.
        "asDropdown": True,
        "includeVars": True,
        "keepTime": True,
        "title": "netlab dashboards",
    }
]
