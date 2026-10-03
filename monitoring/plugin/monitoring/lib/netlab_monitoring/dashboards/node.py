"""The node detail dashboard."""

from __future__ import annotations

from .panels import BGP_STATE, LINKS, UP_DOWN, Board, color_cell, q, stat, table, ts, variables


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
    b.add(
        ts(
            "BGP prefixes received per peer",
            [q(f"sum without (afi, safi) (netlab_bgp_prefixes_received{{{sel}}})", "{{peer_node}} {{peer}}")],
            "none",
        ),
        12,
        7,
    )
    b.add(
        ts(
            "BGP UPDATEs per peer",
            [
                q(f"rate(netlab_bgp_updates_received_total{{{sel}}}[$__rate_interval])", "in {{peer_node}} {{peer}}"),
                q(f"rate(netlab_bgp_updates_sent_total{{{sel}}}[$__rate_interval])", "out {{peer_node}} {{peer}}"),
            ],
            "none",
            "Spikes = prefix churn (route injection, flaps, policy changes)",
        ),
        12,
        7,
    )
    b.add(
        ts(
            "OSPF LSAs by type",
            [q(f"sum by (type) (netlab_ospf_lsas_by_type{{{sel}}})", "{{type}}")],
            "none",
            "Router LSAs = routers in the area, network LSAs = multi-access segments, summary = inter-area",
            stack=True,
        ),
        12,
        7,
    )
    b.add(
        ts(
            "OSPF retransmissions and neighbor changes",
            [
                q(
                    f"increase(netlab_ospf_neighbor_retransmissions_total{{{sel}}}[5m])",
                    "retransmissions {{peer_node}}",
                ),
                q(f"increase(netlab_ospf_neighbor_changes_total{{{sel}}}[5m])", "state changes {{peer_node}}"),
            ],
            "none",
            "Per neighbor, last 5 minutes. Retransmissions = LSAs not acknowledged in time (loss, CPU, MTU)",
        ),
        12,
        7,
    )
    b.add(ts("Routes", [q(f'netlab_routes{{{sel},table="rib"}}', "{{afi}} {{protocol}}")], "none"), 24, 7)
    return b.build(variables(True, False), LINKS)
