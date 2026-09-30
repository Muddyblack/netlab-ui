"""Tiny Prometheus text-format builder (no client library needed)."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping

# name -> (type, help). Families not listed here are exported as untyped.
FAMILIES: dict[str, tuple[str, str]] = {
    # inventory / intent
    "netlab_node_info": ("gauge", "Node inventory (value 1): device, provider and collection methods"),
    "netlab_link_info": ("gauge", "Link inventory (value 1): both ends of every lab link"),
    "netlab_node_up": ("gauge", "1 when the node's container or VM is running"),
    "netlab_collector_up": ("gauge", "1 when the collection method worked for the node in the last cycle"),
    "netlab_collector_duration_seconds": ("gauge", "Time spent collecting the node with the method"),
    "netlab_collector_cycle_seconds": ("gauge", "Duration of the last full collection cycle"),
    "netlab_collector_nodes": ("gauge", "Nodes in the collection plan"),
    "netlab_expected_bgp_session": ("gauge", "BGP session the netlab topology expects (value 1)"),
    "netlab_expected_ospf_adjacency": ("gauge", "OSPF adjacency the netlab topology expects (value 1)"),
    "netlab_expected_isis_adjacency": ("gauge", "IS-IS adjacency the netlab topology expects (value 1)"),
    # node resources
    "netlab_node_cpu_seconds_total": ("counter", "CPU time used by the node"),
    "netlab_node_memory_bytes": ("gauge", "Memory used by the node (working set)"),
    # interfaces
    "netlab_if_rx_bytes_total": ("counter", "Bytes received on the interface"),
    "netlab_if_tx_bytes_total": ("counter", "Bytes sent on the interface"),
    "netlab_if_rx_packets_total": ("counter", "Packets received on the interface"),
    "netlab_if_tx_packets_total": ("counter", "Packets sent on the interface"),
    "netlab_if_rx_errors_total": ("counter", "Receive errors on the interface"),
    "netlab_if_tx_errors_total": ("counter", "Transmit errors on the interface"),
    "netlab_if_rx_drops_total": ("counter", "Received packets dropped on the interface"),
    "netlab_if_tx_drops_total": ("counter", "Transmitted packets dropped on the interface"),
    "netlab_if_oper_up": ("gauge", "1 when the interface is operationally up"),
    "netlab_if_carrier_changes_total": ("counter", "Carrier (link up/down) transitions of the interface"),
    # OSPF
    "netlab_ospf_neighbor_state": ("gauge", "OSPF neighbor FSM state (1 down .. 8 full)"),
    "netlab_ospf_neighbor_up": ("gauge", "1 when the OSPF adjacency is full (or 2-way between DROthers)"),
    "netlab_ospf_neighbor_changes_total": ("counter", "OSPF neighbor state changes"),
    "netlab_ospf_neighbor_last_change_timestamp_seconds": ("gauge", "Time of the last OSPF neighbor state change"),
    "netlab_ospf_spf_runs_total": ("counter", "OSPF SPF runs"),
    "netlab_ospf_spf_last_run_timestamp_seconds": ("gauge", "Time of the last OSPF SPF run"),
    "netlab_ospf_spf_last_duration_seconds": ("gauge", "Duration of the last OSPF SPF run"),
    "netlab_ospf_lsas": ("gauge", "LSAs in the OSPF area database"),
    "netlab_ospf_lsas_by_type": ("gauge", 'LSAs in the OSPF database by type (external: area "")'),
    "netlab_ospf_neighbors_full": ("gauge", "Full OSPF adjacencies in the area"),
    "netlab_ospf_neighbor_retransmissions_total": ("counter", "LSA retransmissions to the OSPF neighbor"),
    # IS-IS
    "netlab_isis_adjacency_up": ("gauge", "1 when the IS-IS adjacency is up"),
    "netlab_isis_adjacency_changes_total": ("counter", "IS-IS adjacency flaps"),
    "netlab_isis_adjacency_last_change_timestamp_seconds": ("gauge", "Time of the last IS-IS adjacency change"),
    "netlab_isis_spf_runs_total": ("counter", "IS-IS SPF runs"),
    "netlab_isis_spf_last_run_timestamp_seconds": ("gauge", "Time of the last IS-IS SPF run"),
    "netlab_isis_spf_last_duration_seconds": ("gauge", "Duration of the last IS-IS SPF run"),
    # BGP
    "netlab_bgp_session_state": ("gauge", "BGP FSM state (1 idle .. 6 established)"),
    "netlab_bgp_session_up": ("gauge", "1 when the BGP session is established"),
    "netlab_bgp_session_established_total": ("counter", "Times the BGP session reached Established"),
    "netlab_bgp_session_dropped_total": ("counter", "Times an established BGP session went down"),
    "netlab_bgp_session_last_change_timestamp_seconds": (
        "gauge",
        "Time the BGP session was last established or reset",
    ),
    "netlab_bgp_updates_received_total": ("counter", "BGP UPDATE messages received"),
    "netlab_bgp_updates_sent_total": ("counter", "BGP UPDATE messages sent"),
    "netlab_bgp_messages_received_total": ("counter", "BGP messages received"),
    "netlab_bgp_messages_sent_total": ("counter", "BGP messages sent"),
    "netlab_bgp_prefixes_received": ("gauge", "Prefixes accepted from the BGP neighbor"),
    "netlab_bgp_prefixes_sent": ("gauge", "Prefixes advertised to the BGP neighbor"),
    # BFD
    "netlab_bfd_session_up": ("gauge", "1 when the BFD session is up"),
    "netlab_bfd_session_down_total": ("counter", "BFD session down events"),
    # routing table
    "netlab_routes": ("gauge", "Routes in the routing table by protocol (table=rib|fib)"),
}


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _fmt(value: float) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return repr(float(value))


class Sink:
    """Collects samples for one node (or the collector itself)."""

    __slots__ = ("base", "samples")

    def __init__(self, base: Mapping[str, str] | None = None) -> None:
        self.base = dict(base or {})
        self.samples: list[tuple[str, dict[str, str], float]] = []

    def add(self, name: str, value: float | None, **labels: object) -> None:
        if value is None:
            return
        merged = dict(self.base)
        for key, val in labels.items():
            if val is not None and val != "":
                merged[key] = str(val)
        self.samples.append((name, merged, value))


def render(sinks: Iterable[Sink]) -> str:
    """Prometheus text exposition, grouped by metric family."""
    families: dict[str, list[str]] = {}
    for sink in sinks:
        for name, labels, value in sink.samples:
            if labels:
                label_text = ",".join(f'{k}="{_escape(v)}"' for k, v in sorted(labels.items()))
                line = f"{name}{{{label_text}}} {_fmt(value)}"
            else:
                line = f"{name} {_fmt(value)}"
            families.setdefault(name, []).append(line)
    out: list[str] = []
    for name in sorted(families):
        kind, help_text = FAMILIES.get(name, ("untyped", ""))
        if help_text:
            out.append(f"# HELP {name} {help_text}")
        out.append(f"# TYPE {name} {kind}")
        out.extend(families[name])
    out.append("")
    return "\n".join(out)
