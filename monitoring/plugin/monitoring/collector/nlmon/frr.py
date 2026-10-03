"""FRR-based nodes (FRR, Cumulus, VyOS, SONiC ...): protocol state over vty sockets.

The FRR daemons listen on unix sockets (<rundir>/<daemon>.vty). The collector opens
them through /proc/<pid>/root, so it needs neither ``docker exec`` nor network access
to the node, and no exporter inside the node. One request is a command terminated by
a NUL byte; the reply ends with three NUL bytes and a status byte.
"""

from __future__ import annotations

import json
import os
import re
import socket
import time
from collections.abc import Callable

from .metrics import Sink

OSPF_STATES = {
    "down": 1,
    "attempt": 2,
    "init": 3,
    "2-way": 4,
    "exstart": 5,
    "exchange": 6,
    "loading": 7,
    "full": 8,
}
BGP_STATES = {"idle": 1, "connect": 2, "active": 3, "opensent": 4, "openconfirm": 5, "established": 6}

# daemon -> protocols that need it
DAEMON_FOR = {
    "ospf": "ospfd",
    "ospf6": "ospf6d",
    "isis": "isisd",
    "bgp": "bgpd",
    "bfd": "bfdd",
    "vxlan": "zebra",
    "routes": "zebra",
}


class VtyError(Exception):
    pass


def vty_query(path: str, commands: list[str], timeout: float = 2.0) -> list[str]:
    """Run commands on one FRR daemon; returns one output string per command."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(path)
        outputs = []
        for command in ["enable", *commands]:
            sock.sendall(command.encode() + b"\0")
            buf = bytearray()
            while not (len(buf) >= 4 and buf[-4:-1] == b"\0\0\0"):
                chunk = sock.recv(262144)
                if not chunk:
                    raise VtyError(f"{path}: connection closed")
                buf += chunk
            outputs.append(buf[:-4].decode(errors="replace"))
        return outputs[1:]
    except OSError as exc:
        raise VtyError(f"{path}: {exc}") from exc
    finally:
        sock.close()


def _json(text: str) -> object:
    try:
        return json.loads(text) if text.strip() else None
    except ValueError:
        return None


_DURATION = re.compile(r"(\d+)\s*([wdhms])")


def parse_duration(text: str | None) -> float | None:
    """'51s', '1m02s', '2d03h04m', '00:01:02' or '1d02:03:04' -> seconds."""
    if not text:
        return None
    text = str(text).strip()
    days = 0.0
    if "d" in text and ":" in text:
        head, _, text = text.partition("d")
        days = float(head) * 86400
    if ":" in text:
        try:
            parts = [float(p) for p in text.split(":")]
        except ValueError:
            return None
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + part
        return days + seconds
    units = {"w": 604800, "d": 86400, "h": 3600, "m": 60, "s": 1}
    found = _DURATION.findall(text)
    if not found:
        return None
    return days + sum(int(value) * units[unit] for value, unit in found)


def _afi_safi(key: str) -> tuple[str, str]:
    """FRR address-family keys: ipv4Unicast -> (ipv4, unicast), l2VpnEvpn -> (l2vpn, evpn)."""
    match = re.match(r"(ipv4|ipv6|l2Vpn)(.*)", key)
    if not match:
        return key.lower(), ""
    return match.group(1).lower(), match.group(2).lower()


class Resolver:
    """Maps addresses, router IDs, hostnames and device interface names to netlab names."""

    def __init__(self, addresses: dict[str, str], router_ids: dict[str, str], nodes: set[str]) -> None:
        self.addresses = addresses
        self.router_ids = router_ids
        self.nodes = nodes

    def node_for(self, value: str | None) -> str | None:
        if not value:
            return None
        value = str(value).split("/")[0].split("%")[0]
        return self.addresses.get(value) or self.router_ids.get(value) or (value if value in self.nodes else None)


# ---------------------------------------------------------------- parsers


_LSA_TYPES = (
    ("lsaRouterNumber", "router"),
    ("lsaNetworkNumber", "network"),
    ("lsaSummaryNumber", "summary"),
    ("lsaAsbrNumber", "asbr-summary"),
    ("lsaNssaNumber", "nssa"),
    ("lsaOpaqueAreaNumber", "opaque-area"),
)


def ospf_process(sink: Sink, data: object, now: float) -> None:
    if not isinstance(data, dict):
        return
    last_ms = data.get("spfLastExecutedMsecs")
    if isinstance(last_ms, (int, float)):
        sink.add("netlab_ospf_spf_last_run_timestamp_seconds", round(now - last_ms / 1000, 3))
    sink.add("netlab_ospf_lsas_by_type", data.get("lsaExternalCounter"), area="", type="external")
    duration = data.get("spfLastDurationMsecs")
    if isinstance(duration, (int, float)):
        sink.add("netlab_ospf_spf_last_duration_seconds", duration / 1000)
    for area, adata in (data.get("areas") or {}).items():
        if not isinstance(adata, dict):
            continue
        sink.add("netlab_ospf_spf_runs_total", adata.get("spfExecutedCounter"), area=area)
        sink.add("netlab_ospf_lsas", adata.get("lsaNumber"), area=area)
        for key, kind in _LSA_TYPES:
            sink.add("netlab_ospf_lsas_by_type", adata.get(key), area=area, type=kind)
        sink.add("netlab_ospf_neighbors_full", adata.get("nbrFullAdjacentCounter"), area=area)


def ospf_neighbors(sink: Sink, data: object, now: float, resolver: Resolver, ifmap: dict[str, dict]) -> None:
    neighbors = (data or {}).get("neighbors") if isinstance(data, dict) else None
    if not isinstance(neighbors, dict):
        return
    for router_id, entries in neighbors.items():
        for entry in entries if isinstance(entries, list) else [entries]:
            if not isinstance(entry, dict):
                continue
            raw_state = str(entry.get("nbrState") or entry.get("state") or "")
            state_name, _, role = raw_state.partition("/")
            state = OSPF_STATES.get(state_name.lower(), 0)
            dev = str(entry.get("ifaceName") or "").split(":")[0]
            labels = {
                "peer_id": router_id,
                "peer_node": resolver.node_for(router_id) or resolver.node_for(entry.get("ifaceAddress")),
                "area": entry.get("areaId"),
                **(ifmap.get(dev) or {"ifname": dev}),
            }
            labels.pop("link", None)
            sink.add("netlab_ospf_neighbor_state", state, **labels)
            full = state == 8 or (state == 4 and "DROther" in role)
            sink.add("netlab_ospf_neighbor_up", 1 if full else 0, **labels)
            sink.add("netlab_ospf_neighbor_changes_total", entry.get("stateChangeCounter"), **labels)
            sink.add("netlab_ospf_neighbor_retransmissions_total", entry.get("lsaRetransmissions"), **labels)
            since = entry.get("lastPrgrsvChangeMsec")
            if isinstance(since, (int, float)):
                sink.add("netlab_ospf_neighbor_last_change_timestamp_seconds", round(now - since / 1000, 3), **labels)


def isis_summary(sink: Sink, data: object, now: float) -> None:
    for vrf in (data or {}).get("vrfs", []) if isinstance(data, dict) else []:
        for area in vrf.get("areas", []) or []:
            for level in area.get("levels", []) or []:
                labels = {"area": area.get("area"), "level": level.get("id")}
                sink.add("netlab_isis_spf_runs_total", level.get("last-run-count"), **labels)
                usec = level.get("last-run-duration-usec")
                if isinstance(usec, (int, float)):
                    sink.add("netlab_isis_spf_last_duration_seconds", usec / 1e6, **labels)
                elapsed = parse_duration(level.get("last-run-elapsed"))
                if elapsed is not None:
                    sink.add("netlab_isis_spf_last_run_timestamp_seconds", round(now - elapsed, 3), **labels)


def isis_neighbors(sink: Sink, data: object, now: float, resolver: Resolver, ifmap: dict[str, dict]) -> None:
    for area in (data or {}).get("areas", []) if isinstance(data, dict) else []:
        for circuit in area.get("circuits", []) or []:
            if "adj" not in circuit:
                continue
            intf = circuit.get("interface")
            detail = intf if isinstance(intf, dict) else {}
            dev = detail.get("name") if detail else intf
            state = detail.get("state") or circuit.get("state")
            level = circuit.get("level") or detail.get("circuit-type")
            labels = {
                "peer_node": resolver.node_for(circuit.get("adj")) or circuit.get("adj"),
                "area": area.get("area"),
                "level": level,
                **(ifmap.get(str(dev)) or {"ifname": dev}),
            }
            labels.pop("link", None)
            sink.add("netlab_isis_adjacency_up", 1 if str(state).lower() == "up" else 0, **labels)
            sink.add("netlab_isis_adjacency_changes_total", detail.get("adj-flaps"), **labels)
            ago = parse_duration(detail.get("last-ago"))
            if ago is not None:
                sink.add("netlab_isis_adjacency_last_change_timestamp_seconds", round(now - ago, 3), **labels)


def bgp_neighbors(sink: Sink, data: object, now: float, resolver: Resolver, ifmap: dict[str, dict]) -> None:
    if not isinstance(data, dict):
        return
    for vrf, vdata in data.items():
        if not isinstance(vdata, dict):
            continue
        for peer, pdata in vdata.items():
            if not isinstance(pdata, dict) or "bgpState" not in pdata:
                continue
            peer_node = (
                resolver.node_for(peer)
                or resolver.node_for(pdata.get("remoteRouterId"))
                or resolver.node_for(pdata.get("hostname"))
            )
            labels = {
                "peer": peer,
                "peer_node": peer_node,
                "peer_as": pdata.get("remoteAs"),
                "vrf": vdata.get("vrfName") or vrf,
                "type": "ibgp" if pdata.get("nbrInternalLink") else "ebgp",
            }
            if peer in ifmap:  # unnumbered session: the key is the interface
                labels["ifname"] = ifmap[peer].get("ifname")
            state = BGP_STATES.get(str(pdata.get("bgpState")).lower(), 0)
            sink.add("netlab_bgp_session_state", state, **labels)
            sink.add("netlab_bgp_session_up", 1 if state == 6 else 0, **labels)
            sink.add("netlab_bgp_session_established_total", pdata.get("connectionsEstablished"), **labels)
            sink.add("netlab_bgp_session_dropped_total", pdata.get("connectionsDropped"), **labels)
            if state == 6 and isinstance(pdata.get("bgpTimerUpMsec"), (int, float)):
                changed = round(now - pdata["bgpTimerUpMsec"] / 1000, 3)  # the epoch field is whole seconds
            elif state == 6 and isinstance(pdata.get("bgpTimerUpEstablishedEpoch"), (int, float)):
                changed = pdata["bgpTimerUpEstablishedEpoch"]
            elif isinstance(pdata.get("lastResetTimerMsecs"), (int, float)):
                changed = round(now - pdata["lastResetTimerMsecs"] / 1000, 3)
            else:
                changed = None
            sink.add("netlab_bgp_session_last_change_timestamp_seconds", changed, **labels)
            stats = pdata.get("messageStats") or {}
            sink.add("netlab_bgp_updates_received_total", stats.get("updatesRecv"), **labels)
            sink.add("netlab_bgp_updates_sent_total", stats.get("updatesSent"), **labels)
            sink.add("netlab_bgp_messages_received_total", stats.get("totalRecv"), **labels)
            sink.add("netlab_bgp_messages_sent_total", stats.get("totalSent"), **labels)
            for af_key, af in (pdata.get("addressFamilyInfo") or {}).items():
                if not isinstance(af, dict):
                    continue
                afi, safi = _afi_safi(af_key)
                sink.add("netlab_bgp_prefixes_received", af.get("acceptedPrefixCounter"), afi=afi, safi=safi, **labels)
                sink.add("netlab_bgp_prefixes_sent", af.get("sentPrefixCounter"), afi=afi, safi=safi, **labels)


def bfd_peers(sink: Sink, peers: object, counters: object, resolver: Resolver, ifmap: dict[str, dict]) -> None:
    def key(entry: dict) -> tuple:
        return (entry.get("peer"), entry.get("interface"), entry.get("vrf"), entry.get("local"))

    down_events = {}
    for entry in counters if isinstance(counters, list) else []:
        if isinstance(entry, dict):
            down_events[key(entry)] = entry.get("session-down", entry.get("session-down-event"))
    for entry in peers if isinstance(peers, list) else []:
        if not isinstance(entry, dict):
            continue
        dev = entry.get("interface")
        labels = {
            "peer": entry.get("peer"),
            "peer_node": resolver.node_for(entry.get("peer")),
            "vrf": entry.get("vrf"),
            "multihop": "true" if entry.get("multihop") else None,
            **((ifmap.get(str(dev)) or {"ifname": dev}) if dev else {}),
        }
        labels.pop("link", None)
        sink.add("netlab_bfd_session_up", 1 if str(entry.get("status")).lower() == "up" else 0, **labels)
        sink.add("netlab_bfd_session_down_total", down_events.get(key(entry)), **labels)


def evpn_vnis(sink: Sink, data: object) -> None:
    """VXLAN VNIs zebra knows (``show evpn vni json``, keyed by VNI): a VNI listed here has its
    VXLAN interface up under FRR's EVPN control, so a VNI the topology defines but this does not
    list is down or never came up. L3 VNIs (symmetric IRB) have no remote-VTEP count."""
    if not isinstance(data, dict):
        return
    for key, vni in data.items():
        if not isinstance(vni, dict):
            continue
        labels = {
            "vni": vni.get("vni", key),
            "type": str(vni.get("type") or "").lower(),
            "vrf": vni.get("tenantVrf") if vni.get("tenantVrf") not in (None, "default") else None,
            "vxlan_if": vni.get("vxlanIf") or vni.get("vxlanInterface"),
        }
        sink.add("netlab_vxlan_vni_up", 1, **labels)
        sink.add("netlab_vxlan_vni_macs", _number(vni.get("numMacs")), **labels)
        sink.add("netlab_vxlan_vni_neighbors", _number(vni.get("numArpNd")), **labels)
        sink.add("netlab_vxlan_vni_remote_vteps", _number(vni.get("numRemoteVteps")), **labels)


def _number(value: object) -> int | float | None:
    """A count FRR reports, or None where it says "n/a" (or nothing)."""
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def route_summary(sink: Sink, data: object, afi: str) -> None:
    for route in (data or {}).get("routes", []) if isinstance(data, dict) else []:
        protocol = route.get("type")
        sink.add("netlab_routes", route.get("rib"), afi=afi, protocol=protocol, table="rib")
        sink.add("netlab_routes", route.get("fib"), afi=afi, protocol=protocol, table="fib")


# ---------------------------------------------------------------- driver


def find_rundir(root: str, candidates: list[str]) -> str | None:
    for rel in candidates:
        path = os.path.join(root, rel.strip("/"))
        if os.path.isdir(path):
            return path
    return None


def collect(
    sink: Sink,
    root: str,
    protocols: list[str],
    socket_dirs: list[str],
    resolver: Resolver,
    ifmap: dict[str, dict],
    query: Callable[[str, list[str]], list[str]] = vty_query,
) -> bool:
    """Collect all protocols of one FRR node. ``root`` is the node's filesystem root
    as seen from the collector (/proc/<pid>/root). Returns False when no daemon answered."""
    rundir = find_rundir(root, socket_dirs)
    if rundir is None:
        return False
    now = time.time()
    answered = False

    def ask(daemon: str, commands: list[str]) -> list[object] | None:
        nonlocal answered
        path = f"{rundir}/{daemon}.vty"
        if not os.path.exists(path):
            return None
        try:
            result = [_json(text) for text in query(path, commands)]
        except VtyError:
            return None
        answered = True
        return result

    if "ospf" in protocols:
        res = ask("ospfd", ["show ip ospf json", "show ip ospf neighbor detail json"])
        if res:
            ospf_process(sink, res[0], now)
            ospf_neighbors(sink, res[1], now, resolver, ifmap)
    if "isis" in protocols:
        res = ask("isisd", ["show isis summary json", "show isis neighbor detail json"])
        if res:
            isis_summary(sink, res[0], now)
            isis_neighbors(sink, res[1], now, resolver, ifmap)
    if "bgp" in protocols:
        res = ask("bgpd", ["show bgp vrf all neighbors json"])
        if res:
            bgp_neighbors(sink, res[0], now, resolver, ifmap)
    if "bfd" in protocols:
        res = ask("bfdd", ["show bfd peers json", "show bfd peers counters json"])
        if res:
            bfd_peers(sink, res[0], res[1], resolver, ifmap)
    if "vxlan" in protocols:
        res = ask("zebra", ["show evpn vni json"])
        if res:
            evpn_vnis(sink, res[0])
    res = ask("zebra", ["show ip route summary json", "show ipv6 route summary json"])
    if res:
        route_summary(sink, res[0], "ipv4")
        route_summary(sink, res[1], "ipv6")
    return answered
