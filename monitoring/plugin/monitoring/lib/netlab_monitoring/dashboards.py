"""Grafana dashboards, generated so they stay consistent and use only canonical metrics.

Every query uses netlab_* metric names and netlab labels (node, ifname, link, peer_node),
so the same dashboards work for FRR, gNMI, SNMP and host-only nodes.
"""

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
        panel.update({"id": self._id(), "datasource": DS, "gridPos": self._place(w, h)})
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
            "templating": {"list": variables},
            "links": links,
            "panels": self.panels,
            "annotations": {
                "list": [
                    {
                        "builtIn": 1,
                        "datasource": {"type": "grafana", "uid": "-- Grafana --"},
                        "enable": True,
                        "hide": False,
                        "iconColor": "rgba(255, 152, 48, 1)",
                        "name": "netlab events",
                        "type": "dashboard",
                        "target": {"type": "tags", "tags": ["netlab"], "limit": 100, "matchAny": True},
                    }
                ]
            },
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
                "noValue": "0",
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
            "defaults": {"mappings": mappings or [], "custom": {"align": "auto"}},
            "overrides": overrides or [],
        },
        "transformations": [
            {"id": "merge", "options": {}},
            {"id": "organize", "options": {"excludeByName": hidden, "renameByName": rename or {}}},
        ],
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
        "asDropdown": False,
        "includeVars": True,
        "keepTime": True,
        "title": "netlab",
    }
]


def overview() -> dict:
    b = Board(
        "netlab-overview",
        "netlab / Lab overview",
        "Health of the whole lab: nodes, expected vs actual adjacencies and sessions, busiest links",
    )
    ok_red = [{"color": "green", "value": None}, {"color": "red", "value": 1}]
    b.row("Lab health")
    b.add(stat("Nodes up", f"sum(netlab_node_up{{{LAB}}})", "Running containers and VMs"), 4, 4)
    b.add(stat("Nodes in lab", f"count(netlab_node_info{{{LAB}}})"), 4, 4)
    b.add(
        stat(
            "BGP sessions up",
            f"sum(netlab_bgp_session_up{{{LAB}}})",
            "Established BGP sessions (both directions counted)",
        ),
        4,
        4,
    )
    b.add(stat("OSPF adjacencies up", f"sum(netlab_ospf_neighbor_up{{{LAB}}})"), 4, 4)
    b.add(stat("IS-IS adjacencies up", f"sum(netlab_isis_adjacency_up{{{LAB}}})"), 4, 4)
    b.add(
        stat(
            "Missing (vs topology)",
            f"count({MISSING_BGP}) + count({MISSING_OSPF}) + count({MISSING_ISIS}) or vector(0)",
            "Sessions and adjacencies the netlab topology defines that are not up",
            thresholds=ok_red,
            color_mode="background",
        ),
        4,
        4,
    )
    b.add(
        table(
            "Missing sessions and adjacencies",
            [
                q(f'label_replace({MISSING_BGP}, "protocol", "BGP", "", "")', instant=True, fmt="table"),
                q(f'label_replace({MISSING_OSPF}, "protocol", "OSPF", "", "")', instant=True, fmt="table"),
                q(f'label_replace({MISSING_ISIS}, "protocol", "IS-IS", "", "")', instant=True, fmt="table"),
            ],
            "Expected by the netlab topology but not up right now",
            hide=["Value", "Value #A", "Value #B", "Value #C"],
            rename={
                "node": "Node",
                "peer_node": "Peer",
                "peer": "Peer address",
                "ifname": "Interface",
                "protocol": "Protocol",
                "vrf": "VRF",
                "area": "Area",
                "type": "Type",
            },
        ),
        24,
        7,
    )
    b.row("Nodes")
    b.add(
        table(
            "Node status",
            [
                q(f"netlab_node_up{{{LAB}}}", instant=True, fmt="table"),
                q(f"rate(netlab_node_cpu_seconds_total{{{LAB}}}[$__rate_interval]) * 100", instant=True, fmt="table"),
                q(f"netlab_node_memory_bytes{{{LAB}}}", instant=True, fmt="table"),
                q(f"sum by (node) (netlab_bgp_session_up{{{LAB}}})", instant=True, fmt="table"),
                q(f"sum by (node) (netlab_ospf_neighbor_up{{{LAB}}})", instant=True, fmt="table"),
                q(f"sum by (node) (netlab_isis_adjacency_up{{{LAB}}})", instant=True, fmt="table"),
            ],
            "One row per node",
            rename={
                "node": "Node",
                "Value #A": "Up",
                "Value #B": "CPU %",
                "Value #C": "Memory",
                "Value #D": "BGP up",
                "Value #E": "OSPF up",
                "Value #F": "IS-IS up",
            },
            overrides=[
                color_cell("Up", UP_DOWN),
                {"matcher": {"id": "byName", "options": "Memory"}, "properties": [{"id": "unit", "value": "bytes"}]},
                {
                    "matcher": {"id": "byName", "options": "CPU %"},
                    "properties": [{"id": "unit", "value": "percent"}, {"id": "decimals", "value": 1}],
                },
            ],
        ),
        12,
        10,
    )
    cpu = f"topk(10, rate(netlab_node_cpu_seconds_total{{{LAB}}}[$__rate_interval]) * 100)"
    b.add(ts("CPU per node (top 10)", [q(cpu, "{{node}}")], "percent"), 12, 5)
    b.add(
        ts("Memory per node (top 10)", [q(f"topk(10, netlab_node_memory_bytes{{{LAB}}})", "{{node}}")], "bytes"), 12, 5
    )
    b.row("Links")
    b.add(
        ts(
            "Busiest links (top 10, both directions)",
            [
                q(
                    f'topk(10, sum by (link) (rate(netlab_if_rx_bytes_total{{{LAB}, link!~"mgmt|"}}[$__rate_interval]) '
                    f'+ rate(netlab_if_tx_bytes_total{{{LAB}, link!~"mgmt|"}}[$__rate_interval])) * 4)',
                    "{{link}}",
                )
            ],
            "bps",
            "Average of both link ends, bits per second",
        ),
        12,
        8,
    )
    b.add(
        ts(
            "Interface errors and drops per minute",
            [
                q(
                    f"sum by (node, ifname) (increase(netlab_if_rx_errors_total{{{LAB}}}[1m]) + "
                    f"increase(netlab_if_tx_errors_total{{{LAB}}}[1m]) + "
                    f"increase(netlab_if_rx_drops_total{{{LAB}}}[1m]) + "
                    f"increase(netlab_if_tx_drops_total{{{LAB}}}[1m])) > 0",
                    "{{node}} {{ifname}}",
                )
            ],
            "short",
        ),
        12,
        8,
    )
    b.add(
        ts(
            "Link state changes (last 5 min)",
            [
                q(
                    f'sum by (node, ifname) (increase(netlab_if_carrier_changes_total{{{LAB}, link!="mgmt"}}[5m])) > 0',
                    "{{node}} {{ifname}}",
                )
            ],
            "none",
            "Carrier up/down transitions",
        ),
        24,
        6,
    )
    return b.build(variables(False, False), LINKS)


def routing() -> dict:
    b = Board(
        "netlab-routing",
        "netlab / Routing & convergence",
        "Control-plane churn: SPF runs, adjacency and session changes, convergence indicators",
    )
    b.row("Convergence indicators")
    b.add(
        ts(
            "Not up vs topology",
            [
                q(f"count({MISSING_BGP}) or vector(0)", "BGP sessions missing"),
                q(f"count({MISSING_OSPF}) or vector(0)", "OSPF adjacencies missing"),
                q(f"count({MISSING_ISIS}) or vector(0)", "IS-IS adjacencies missing"),
            ],
            "none",
            "Drops back to zero when the lab has converged; the width of a bump is the convergence time",
        ),
        12,
        8,
    )
    b.add(
        ts(
            "Control-plane events per minute",
            [
                q(f"sum(increase(netlab_ospf_spf_runs_total{{{NODE}}}[1m]))", "OSPF SPF runs"),
                q(f"sum(increase(netlab_isis_spf_runs_total{{{NODE}}}[1m]))", "IS-IS SPF runs"),
                q(f"sum(increase(netlab_ospf_neighbor_changes_total{{{NODE}}}[1m]))", "OSPF neighbor changes"),
                q(f"sum(increase(netlab_isis_adjacency_changes_total{{{NODE}}}[1m]))", "IS-IS adjacency changes"),
                q(f"sum(increase(netlab_bgp_session_dropped_total{{{NODE}}}[1m]))", "BGP session drops"),
            ],
            "none",
        ),
        12,
        8,
    )
    b.row("SPF")
    b.add(
        ts(
            "OSPF SPF runs per minute",
            [q(f"sum by (node) (increase(netlab_ospf_spf_runs_total{{{NODE}}}[1m]))", "{{node}}")],
            "none",
        ),
        12,
        7,
    )
    b.add(
        ts(
            "SPF duration",
            [
                q(f"netlab_ospf_spf_last_duration_seconds{{{NODE}}}", "OSPF {{node}}"),
                q(f"netlab_isis_spf_last_duration_seconds{{{NODE}}}", "IS-IS {{node}} L{{level}}"),
            ],
            "s",
        ),
        12,
        7,
    )
    b.row("BGP")
    b.add(
        table(
            "BGP sessions",
            [
                q(f"netlab_bgp_session_state{{{NODE}}}", instant=True, fmt="table"),
                q(f"sum without (afi, safi) (netlab_bgp_prefixes_received{{{NODE}}})", instant=True, fmt="table"),
                q(f"netlab_bgp_session_dropped_total{{{NODE}}}", instant=True, fmt="table"),
                q(f"time() - netlab_bgp_session_last_change_timestamp_seconds{{{NODE}}}", instant=True, fmt="table"),
            ],
            rename={
                "node": "Node",
                "peer": "Peer",
                "peer_node": "Peer node",
                "peer_as": "Peer AS",
                "vrf": "VRF",
                "type": "Type",
                "Value #A": "State",
                "Value #B": "Prefixes in",
                "Value #C": "Drops",
                "Value #D": "Since last change",
            },
            overrides=[
                color_cell("State", BGP_STATE),
                {
                    "matcher": {"id": "byName", "options": "Since last change"},
                    "properties": [{"id": "unit", "value": "s"}],
                },
            ],
        ),
        24,
        8,
    )
    b.add(
        ts(
            "BGP UPDATEs received per second",
            [q(f"sum by (node) (rate(netlab_bgp_updates_received_total{{{NODE}}}[$__rate_interval]))", "{{node}}")],
            "none",
        ),
        12,
        7,
    )
    b.add(
        ts(
            "Routes in RIB by protocol",
            [q(f'sum by (protocol) (netlab_routes{{{NODE},table="rib",afi="ipv4"}})', "{{protocol}}")],
            "none",
            stack=True,
        ),
        12,
        7,
    )
    b.row("IGP adjacencies")
    b.add(
        table(
            "OSPF neighbors",
            [q(f"netlab_ospf_neighbor_state{{{NODE}}}", instant=True, fmt="table")],
            rename={
                "node": "Node",
                "peer_node": "Peer",
                "peer_id": "Router ID",
                "ifname": "Interface",
                "peer_ifname": "Peer interface",
                "area": "Area",
                "Value": "State",
            },
            overrides=[color_cell("State", OSPF_STATE)],
        ),
        12,
        8,
    )
    b.add(
        table(
            "IS-IS adjacencies",
            [q(f"netlab_isis_adjacency_up{{{NODE}}}", instant=True, fmt="table")],
            rename={
                "node": "Node",
                "peer_node": "Peer",
                "ifname": "Interface",
                "peer_ifname": "Peer interface",
                "area": "Area",
                "level": "Level",
                "Value": "State",
                "peer_id": "System ID",
            },
            overrides=[color_cell("State", UP_DOWN)],
        ),
        12,
        8,
    )
    return b.build(variables(True, True), LINKS)


def node_detail() -> dict:
    b = Board("netlab-node", "netlab / Node detail", "Resources, interfaces and protocol state of one node")
    sel = 'lab="$lab",node="$node"'
    b.row("$node")
    b.add(
        stat(
            "Up",
            f"netlab_node_up{{{sel}}}",
            thresholds=[{"color": "red", "value": None}, {"color": "green", "value": 1}],
            color_mode="background",
        ),
        4,
        4,
    )
    b.add(stat("CPU", f"rate(netlab_node_cpu_seconds_total{{{sel}}}[$__rate_interval]) * 100", unit="percent"), 4, 4)
    b.add(stat("Memory", f"netlab_node_memory_bytes{{{sel}}}", unit="bytes"), 4, 4)
    b.add(stat("Interfaces up", f'sum(netlab_if_oper_up{{{sel},link!="mgmt"}})'), 4, 4)
    b.add(stat("BGP sessions up", f"sum(netlab_bgp_session_up{{{sel}}})"), 4, 4)
    b.add(
        stat(
            "IGP adjacencies up",
            f"(sum(netlab_ospf_neighbor_up{{{sel}}}) or vector(0)) + (sum(netlab_isis_adjacency_up{{{sel}}}) "
            "or vector(0))",
        ),
        4,
        4,
    )
    b.add(
        ts("CPU", [q(f"rate(netlab_node_cpu_seconds_total{{{sel}}}[$__rate_interval]) * 100", "CPU")], "percent"), 12, 7
    )
    b.add(ts("Memory", [q(f"netlab_node_memory_bytes{{{sel}}}", "memory")], "bytes"), 12, 7)
    b.row("Interfaces")
    b.add(
        ts(
            "Receive",
            [q(f'rate(netlab_if_rx_bytes_total{{{sel},link!="mgmt"}}[$__rate_interval]) * 8', "{{ifname}} ({{link}})")],
            "bps",
        ),
        12,
        8,
    )
    b.add(
        ts(
            "Transmit",
            [q(f'rate(netlab_if_tx_bytes_total{{{sel},link!="mgmt"}}[$__rate_interval]) * 8', "{{ifname}} ({{link}})")],
            "bps",
        ),
        12,
        8,
    )
    b.add(
        table(
            "Interfaces",
            [
                q(f"netlab_if_oper_up{{{sel}}}", instant=True, fmt="table"),
                q(f"netlab_if_carrier_changes_total{{{sel}}}", instant=True, fmt="table"),
                q(f"rate(netlab_if_rx_bytes_total{{{sel}}}[$__rate_interval]) * 8", instant=True, fmt="table"),
                q(f"rate(netlab_if_tx_bytes_total{{{sel}}}[$__rate_interval]) * 8", instant=True, fmt="table"),
            ],
            rename={
                "ifname": "Interface",
                "link": "Link",
                "peer_node": "Peer",
                "peer_ifname": "Peer interface",
                "Value #A": "State",
                "Value #B": "Link changes",
                "Value #C": "Rx",
                "Value #D": "Tx",
            },
            hide=["node"],
            overrides=[
                color_cell("State", UP_DOWN),
                {"matcher": {"id": "byRegexp", "options": "Rx|Tx"}, "properties": [{"id": "unit", "value": "bps"}]},
            ],
        ),
        24,
        8,
    )
    b.row("Protocols")
    b.add(
        table(
            "BGP",
            [q(f"netlab_bgp_session_state{{{sel}}}", instant=True, fmt="table")],
            rename={
                "peer": "Peer",
                "peer_node": "Peer node",
                "peer_as": "AS",
                "vrf": "VRF",
                "type": "Type",
                "Value": "State",
            },
            hide=["node"],
            overrides=[color_cell("State", BGP_STATE)],
        ),
        12,
        7,
    )
    b.add(
        table(
            "OSPF / IS-IS",
            [
                q(
                    f'label_replace(netlab_ospf_neighbor_up{{{sel}}}, "protocol", "OSPF", "", "") or '
                    f'label_replace(netlab_isis_adjacency_up{{{sel}}}, "protocol", "IS-IS", "", "")',
                    instant=True,
                    fmt="table",
                ),
            ],
            rename={"protocol": "Protocol", "peer_node": "Peer", "ifname": "Interface", "Value": "State"},
            hide=["node", "peer_id", "peer_ifname", "area", "level"],
            overrides=[color_cell("State", UP_DOWN)],
        ),
        12,
        7,
    )
    b.add(ts("Routes", [q(f'netlab_routes{{{sel},table="rib"}}', "{{afi}} {{protocol}}")], "none"), 24, 7)
    return b.build(variables(True, False), LINKS)


def build(plan: dict) -> dict[str, dict]:
    del plan  # dashboards are lab-independent (the lab is a variable)
    return {"netlab-overview": overview(), "netlab-routing": routing(), "netlab-node": node_detail()}
