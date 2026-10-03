"""The routing and convergence dashboard: flaps, neighbor states, BGP per peer, SPF, LSAs."""

from __future__ import annotations

from .panels import (
    BGP_STATE,
    LINKS,
    MISSING_BGP,
    MISSING_ISIS,
    MISSING_OSPF,
    NODE,
    OSPF_STATE,
    UP_DOWN,
    Board,
    color_cell,
    q,
    table,
    ts,
    variables,
)


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
    b.add(
        ts(
            "Session and adjacency changes per router (5 min)",
            [
                q(
                    f"sum by (node) (increase(netlab_ospf_neighbor_changes_total{{{NODE}}}[5m]) or "
                    f"increase(netlab_isis_adjacency_changes_total{{{NODE}}}[5m]) or "
                    f"increase(netlab_bgp_session_dropped_total{{{NODE}}}[5m]) or "
                    f'increase(netlab_if_carrier_changes_total{{{NODE},link!="mgmt"}}[5m])) > 0',
                    "{{node}}",
                )
            ],
            "none",
            "Flaps: routers whose adjacencies, sessions or links changed. Repeated bumps on one router = unstable link",
            legend="table",
        ),
        12,
        8,
    )
    b.add(
        ts(
            "OSPF neighbor states",
            [
                q(f"count(netlab_ospf_neighbor_state{{{NODE}}} == 8) or vector(0)", "Full"),
                q(f"count(netlab_ospf_neighbor_state{{{NODE}}} == 4) or vector(0)", "2-Way"),
                q(f"count(netlab_ospf_neighbor_state{{{NODE}}} >= 5 < 8) or vector(0)", "ExStart/Exchange/Loading"),
                q(f"count(netlab_ospf_neighbor_state{{{NODE}}} <= 3) or vector(0)", "Down/Init"),
            ],
            "none",
            "All neighbors settle in Full (2-Way is normal between DROthers); time outside Full = convergence",
            stack=True,
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
