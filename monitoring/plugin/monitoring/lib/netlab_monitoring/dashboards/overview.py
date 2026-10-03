"""The lab overview dashboard: health against the topology, traffic, links."""

from __future__ import annotations

from .panels import (
    LAB,
    LINKS,
    MISSING_BGP,
    MISSING_ISIS,
    MISSING_OSPF,
    UP_DOWN,
    Board,
    color_cell,
    node_graph,
    q,
    stat,
    table,
    ts,
    variables,
)


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
            no_value="Nothing missing: everything the topology defines is up",
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
    # netlab-ui shows the lab itself; this graph is for Grafana on its own (netlab CLI)
    b.collapsed_row("Topology graph", node_graph(), 12)
    return b.build(variables(False, False), LINKS)
