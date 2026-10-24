# gnmic event-starlark processor: map gNMI telemetry (SR Linux native and OpenConfig)
# onto the canonical netlab_* metrics the FRR collector produces.
#
# The plugin prepends LAB, ADDRESSES, ROUTER_IDS and INTERFACES for the lab.
# Unknown paths are dropped, so adding a metric means adding a line to a table below.

IF_COUNTERS = {
    "in-octets": "netlab_if_rx_bytes_total",
    "out-octets": "netlab_if_tx_bytes_total",
    "in-unicast-packets": "netlab_if_rx_packets_total",
    "out-unicast-packets": "netlab_if_tx_packets_total",
    "in-unicast-pkts": "netlab_if_rx_packets_total",
    "out-unicast-pkts": "netlab_if_tx_packets_total",
    "in-error-packets": "netlab_if_rx_errors_total",
    "out-error-packets": "netlab_if_tx_errors_total",
    "in-errors": "netlab_if_rx_errors_total",
    "out-errors": "netlab_if_tx_errors_total",
    "in-discarded-packets": "netlab_if_rx_drops_total",
    "out-discarded-packets": "netlab_if_tx_drops_total",
    "in-discards": "netlab_if_rx_drops_total",
    "out-discards": "netlab_if_tx_drops_total",
    "carrier-transitions": "netlab_if_carrier_changes_total",
}
BGP_STATES = {"idle": 1, "connect": 2, "active": 3, "opensent": 4, "openconfirm": 5, "established": 6}
OSPF_STATES = {"down": 1, "attempt": 2, "init": 3, "two-way": 4, "2-way": 4, "exstart": 5,
               "exchange": 6, "loading": 7, "full": 8}


def _elems(path):
    out = []
    for p in path.split("/"):
        if p:
            out.append(p.split(":")[-1])
    return out


def _tags(tags):
    out = {}
    for k, v in tags.items():
        out[k.split(":")[-1]] = v
    return out


def _num(v):
    t = type(v)
    if t == "int" or t == "float":
        return v
    if t == "string" and v.isdigit():
        return int(v)
    return None


def _word(v):
    s = str(v).split(":")[-1].lower().replace("_", "-")
    return s


def _node_for(value):
    if value == None:
        return None
    v = str(value).split("/")[0]
    if v in ADDRESSES:
        return ADDRESSES[v]
    if v in ROUTER_IDS:
        return ROUTER_IDS[v]
    return None


def _if_labels(node, dev):
    table = INTERFACES.get(node, {})
    labels = table.get(dev)
    if labels == None and "." in dev:
        # Routing protocols run on a subinterface (SR Linux: "ethernet-1/1.0"); the interface the
        # topology and the interface metrics name is the part before the dot.
        labels = table.get(dev.rsplit(".", 1)[0])
    if labels == None:
        return {"ifname": dev}
    return dict(labels)


def _int_text(v):
    # gNMI JSON numbers arrive as floats: 65000.0 must read 65000
    if type(v) == "float" and v == int(v):
        return str(int(v))
    return str(v)


def _epoch(v):
    # "2026-10-03T21:13:34.000Z" (UTC, as gNMI devices report times) -> seconds since 1970, or None
    s = str(v)
    if len(s) < 19 or s[4] != "-" or s[10] != "T":
        return None
    y = int(s[0:4])
    mo = int(s[5:7])
    d = int(s[8:10])
    secs = int(s[11:13]) * 3600 + int(s[14:16]) * 60 + int(s[17:19])
    if mo <= 2:
        y = y - 1
    era = y // 400
    yoe = y - era * 400
    mp = mo - 3 if mo > 2 else mo + 9
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return (era * 146097 + doe - 719468) * 86400 + secs


def _afi(name):
    s = _word(name)                      # ipv4-unicast, l2vpn-evpn
    parts = s.split("-")
    return parts[0], "-".join(parts[1:])


def apply(*events):
    out = []
    for e in events:
        tags = _tags(e.tags)
        node = tags.get("source", "")
        base = {"lab": LAB, "node": node}
        values = {}
        labels = dict(base)
        for path, value in e.values.items():
            p = _elems(path)
            if len(p) == 0:
                continue
            leaf = p[-1]
            if p[0] in ("interface", "interfaces"):
                labels.update(_if_labels(node, tags.get("interface_name", tags.get("name", ""))))
                if leaf in IF_COUNTERS and _num(value) != None:
                    values[IF_COUNTERS[leaf]] = _num(value)
                elif leaf in ("oper-state", "oper-status"):
                    values["netlab_if_oper_up"] = 1 if _word(value) == "up" else 0
            elif "bgp" in p and "neighbor" in p:
                peer = tags.get("neighbor_peer-address", tags.get("neighbor_neighbor-address", ""))
                labels.update({"peer": peer, "vrf": tags.get("network-instance_name", "default")})
                pn = _node_for(peer)
                if pn != None:
                    labels["peer_node"] = pn
                afi = tags.get("afi-safi_afi-safi-name")
                if leaf == "session-state":
                    state = BGP_STATES.get(_word(value), 0)
                    values["netlab_bgp_session_state"] = state
                    values["netlab_bgp_session_up"] = 1 if state == 6 else 0
                elif leaf == "established-transitions" and _num(value) != None:
                    values["netlab_bgp_session_established_total"] = _num(value)
                elif leaf in ("received-routes", "received") and afi != None and _num(value) != None:
                    a, s = _afi(afi)
                    labels.update({"afi": a, "safi": s})
                    values["netlab_bgp_prefixes_received"] = _num(value)
                elif leaf in ("sent-routes", "sent") and afi != None and _num(value) != None:
                    a, s = _afi(afi)
                    labels.update({"afi": a, "safi": s})
                    values["netlab_bgp_prefixes_sent"] = _num(value)
                elif leaf == "peer-as":
                    labels["peer_as"] = _int_text(value)
                elif leaf == "last-established" and _epoch(value) != None:
                    values["netlab_bgp_session_last_change_timestamp_seconds"] = _epoch(value)
                elif leaf in ("total-updates", "total-messages") and len(p) > 1 and _num(value) != None:
                    direction = {"received-messages": "received", "sent-messages": "sent"}.get(p[-2])
                    if direction != None:
                        kind = "updates" if leaf == "total-updates" else "messages"
                        values["netlab_bgp_" + kind + "_" + direction + "_total"] = _num(value)
            elif "ospf" in p or "ospfv2" in p:
                if "neighbor" in p or "neighbors" in p:
                    rid = tags.get("neighbor_router-id", "")
                    dev = tags.get("interface_interface-name", tags.get("interface_id", ""))
                    labels.update(_if_labels(node, dev))
                    labels.pop("link", None)
                    labels.update({"peer_id": rid, "area": tags.get("area_area-id", tags.get("area_identifier", ""))})
                    pn = _node_for(rid)
                    if pn != None:
                        labels["peer_node"] = pn
                    if leaf == "adjacency-state":
                        state = OSPF_STATES.get(_word(value), 0)
                        values["netlab_ospf_neighbor_state"] = state
                        values["netlab_ospf_neighbor_up"] = 1 if state == 8 else 0
                    elif leaf == "state-changes" and _num(value) != None:
                        values["netlab_ospf_neighbor_changes_total"] = _num(value)
                    elif leaf == "last-event-time" and _epoch(value) != None:
                        values["netlab_ospf_neighbor_last_change_timestamp_seconds"] = _epoch(value)
                elif leaf == "full-spf-runs" and _num(value) != None:
                    labels["area"] = tags.get("area_area-id", "")
                    values["netlab_ospf_spf_runs_total"] = _num(value)
                elif leaf == "last-spf-run-time" and _epoch(value) != None:
                    labels["area"] = tags.get("area_area-id", "")
                    values["netlab_ospf_spf_last_run_timestamp_seconds"] = _epoch(value)
            elif "isis" in p:
                if "adjacency" in p or "adjacencies" in p:
                    dev = tags.get("interface_interface-name", tags.get("interface_interface-id", ""))
                    labels.update(_if_labels(node, dev))
                    labels.pop("link", None)
                    sysid = tags.get("adjacency_neighbor-system-id", tags.get("adjacency_system-id", ""))
                    labels["peer_id"] = sysid
                    pn = _node_for(sysid)
                    if pn != None:
                        labels["peer_node"] = pn
                    level = tags.get("level_level-number")
                    if level != None:
                        labels["level"] = level
                    # SR Linux names the adjacency state leaf "state", OpenConfig "adjacency-state"
                    if leaf == "adjacency-state" or leaf == "state":
                        values["netlab_isis_adjacency_up"] = 1 if _word(value) == "up" else 0
                    elif leaf == "up-down-transitions" and _num(value) != None:
                        values["netlab_isis_adjacency_changes_total"] = _num(value)
                    elif leaf == "last-up-down-transition" and _epoch(value) != None:
                        values["netlab_isis_adjacency_last_change_timestamp_seconds"] = _epoch(value)
                elif leaf == "spf-runs" and _num(value) != None:
                    labels["level"] = tags.get("level_level-number", "")
                    values["netlab_isis_spf_runs_total"] = _num(value)
            elif "route-table" in p and leaf in ("total-routes", "active-routes") and _num(value) != None:
                # SR Linux counts routes per address family; FRR's split by routing protocol has no counterpart
                # here, so they are reported as protocol "all". The two counts differ in a label, so each
                # gets an event of its own.
                afi = "ipv4" if "ipv4-unicast" in p else "ipv6"
                table = "rib" if leaf == "total-routes" else "fib"
                out.append(Event(
                    name=e.name,
                    timestamp=e.timestamp,
                    tags=dict(base, afi=afi, protocol="all", table=table),
                    values={"netlab_routes": _num(value)},
                ))
        # An established session is the one transition that did not end in a drop.
        if "netlab_bgp_session_established_total" in values and "netlab_bgp_session_up" in values:
            values["netlab_bgp_session_dropped_total"] = max(
                0, values["netlab_bgp_session_established_total"] - values["netlab_bgp_session_up"]
            )
        if values:
            e.tags = labels
            e.values = values
            out.append(e)
    return out
