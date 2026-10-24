"""A small, dependency-free packet decoder for the captures netlab-ui takes.

Reads classic pcap files (what ``app/lab/capture.py`` writes) and decodes the
protocols that matter in a netlab lab down to a one-line summary: Ethernet
(+VLAN, MPLS), ARP, LLDP, LACP, STP, IS-IS framing, IPv4/IPv6, ICMP/ICMPv6, TCP
and UDP, with the routing and infrastructure protocols named (OSPF, BGP, BFD,
VRRP, LDP, DHCP, DNS, VXLAN, NTP, SNMP...). It does not reassemble streams and
never executes anything from a capture. Anything it cannot decode is still
listed, by EtherType or IP protocol number.
"""

from __future__ import annotations

import ipaddress
import struct
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

MAX_PACKETS = 20_000

_MAGICS = {
    0xA1B2C3D4: ("<", 1e-6),
    0xD4C3B2A1: (">", 1e-6),
    0xA1B23C4D: ("<", 1e-9),
    0x4D3CB2A1: (">", 1e-9),
}
LINKTYPE_ETHERNET = 1


class PcapError(ValueError):
    pass


@dataclass
class Packet:
    number: int
    time: float  # seconds since the first packet
    length: int
    data: bytes = field(repr=False)
    proto: str = "?"  # the most specific protocol we named
    src: str = ""
    dst: str = ""
    sport: int | None = None
    dport: int | None = None
    vlan: int | None = None
    info: str = ""
    layers: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        ends = f"{self.src} → {self.dst}" if self.src or self.dst else ""
        vlan = f" vlan {self.vlan}" if self.vlan is not None else ""
        return f"#{self.number} +{self.time:.3f}s {ends} {self.proto}{vlan} {self.info} ({self.length} B)".replace(
            "  ", " "
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "n": self.number,
            "t": round(self.time, 6),
            "length": self.length,
            "proto": self.proto,
            "src": self.src,
            "dst": self.dst,
            "sport": self.sport,
            "dport": self.dport,
            "vlan": self.vlan,
            "info": self.info,
            "layers": self.layers,
        }


# --------------------------------------------------------------------- pcap
def read_packets(data: bytes, limit: int = MAX_PACKETS) -> tuple[list[Packet], bool]:
    """Decode a classic pcap file; the flag says the file had more than ``limit`` packets."""
    if len(data) < 24:
        raise PcapError("not a pcap file (too short)")
    magic = struct.unpack("<I", data[:4])[0]
    if magic == 0x0A0D0D0A:
        raise PcapError(
            "pcapng files are not supported -- save the capture as classic pcap (tcpdump/netlab-ui write that)"
        )
    if magic not in _MAGICS:
        raise PcapError("not a pcap file (bad magic number)")
    endian, scale = _MAGICS[magic]
    linktype = struct.unpack(endian + "I", data[20:24])[0] & 0x0FFFFFFF
    if linktype != LINKTYPE_ETHERNET:
        raise PcapError(f"link type {linktype} is not supported (Ethernet captures only)")
    packets: list[Packet] = []
    offset, first, truncated = 24, None, False
    while offset + 16 <= len(data):
        sec, frac, caplen, origlen = struct.unpack(endian + "IIII", data[offset : offset + 16])
        offset += 16
        if caplen > 0x40000 or offset + caplen > len(data):
            break
        if len(packets) >= limit:
            truncated = True
            break
        stamp = sec + frac * scale
        first = stamp if first is None else first
        packet = Packet(len(packets) + 1, stamp - first, origlen, data[offset : offset + caplen])
        offset += caplen
        try:
            _decode(packet)
        except (struct.error, IndexError, ValueError):
            packet.notes.append("truncated or malformed")
            if packet.proto == "?":
                packet.proto, packet.info = "Malformed", "cannot decode"
        packets.append(packet)
    return packets, truncated


# ----------------------------------------------------------------- decoding
_ETHERTYPES = {
    0x0800: "IPv4", 0x0806: "ARP", 0x86DD: "IPv6", 0x8100: "VLAN", 0x88A8: "VLAN",
    0x8847: "MPLS", 0x8848: "MPLS", 0x88CC: "LLDP", 0x8809: "LACP", 0x88F7: "PTP",
    0x8035: "RARP", 0x22F3: "TRILL", 0x6558: "TEB",
}  # fmt: skip

_IP_PROTOS = {
    1: "ICMP", 2: "IGMP", 4: "IPIP", 6: "TCP", 17: "UDP", 41: "IPv6-in-IP", 47: "GRE", 50: "ESP",
    51: "AH", 58: "ICMPv6", 89: "OSPF", 103: "PIM", 112: "VRRP", 115: "L2TP", 124: "IS-IS", 132: "SCTP",
}  # fmt: skip

_TCP_PORTS = {
    22: "SSH", 23: "Telnet", 53: "DNS", 80: "HTTP", 179: "BGP", 443: "HTTPS", 646: "LDP", 830: "NETCONF",
    1521: "Oracle", 3306: "MySQL", 5432: "PostgreSQL", 6379: "Redis", 8080: "HTTP", 57400: "gNMI", 50051: "gRPC",
}  # fmt: skip

_UDP_PORTS = {
    53: "DNS", 67: "DHCP", 68: "DHCP", 69: "TFTP", 123: "NTP", 161: "SNMP", 162: "SNMP-trap", 389: "LDAP",
    514: "Syslog", 520: "RIP", 521: "RIPng", 546: "DHCPv6", 547: "DHCPv6", 646: "LDP", 1985: "HSRP",
    3784: "BFD", 3785: "BFD-echo", 4784: "BFD", 4789: "VXLAN", 5353: "mDNS", 6081: "Geneve", 6343: "sFlow",
    2055: "NetFlow", 4739: "IPFIX", 1812: "RADIUS", 1813: "RADIUS", 3799: "RADIUS", 51820: "WireGuard",
}  # fmt: skip

_TCP_FLAGS = (("F", 0x01), ("S", 0x02), ("R", 0x04), ("P", 0x08), ("A", 0x10), ("U", 0x20), ("E", 0x40), ("C", 0x80))

_ICMP = {
    0: "echo reply", 3: "destination unreachable", 4: "source quench", 5: "redirect", 8: "echo request",
    9: "router advertisement", 10: "router solicitation", 11: "time exceeded", 12: "parameter problem",
}  # fmt: skip
_ICMP_UNREACH = {
    0: "net",
    1: "host",
    2: "protocol",
    3: "port",
    4: "fragmentation needed",
    9: "net prohibited",
    13: "admin prohibited",
}
_ICMP6 = {
    1: "destination unreachable", 2: "packet too big", 3: "time exceeded", 4: "parameter problem",
    128: "echo request", 129: "echo reply", 130: "MLD query", 131: "MLD report", 132: "MLD done",
    133: "router solicitation", 134: "router advertisement", 135: "neighbor solicitation",
    136: "neighbor advertisement", 137: "redirect", 143: "MLDv2 report",
}  # fmt: skip
_OSPF = {1: "Hello", 2: "Database Description", 3: "LS Request", 4: "LS Update", 5: "LS Ack"}
_BGP = {1: "OPEN", 2: "UPDATE", 3: "NOTIFICATION", 4: "KEEPALIVE", 5: "ROUTE-REFRESH"}
_BFD_STATE = {0: "AdminDown", 1: "Down", 2: "Init", 3: "Up"}
_LDP = {
    0x0001: "Notification",
    0x0100: "Hello",
    0x0200: "Initialization",
    0x0201: "Keepalive",
    0x0300: "Address",
    0x0400: "Label Mapping",
}
_ISIS = {
    15: "L1 LAN Hello",
    16: "L2 LAN Hello",
    17: "P2P Hello",
    18: "L1 LSP",
    20: "L2 LSP",
    24: "L1 CSNP",
    25: "L2 CSNP",
    26: "L1 PSNP",
    27: "L2 PSNP",
}
_DHCP = {1: "Discover", 2: "Offer", 3: "Request", 4: "Decline", 5: "Ack", 6: "Nak", 7: "Release", 8: "Inform"}


def _mac(raw: bytes) -> str:
    return ":".join(f"{b:02x}" for b in raw)


def _flags(value: int) -> str:
    return "".join(name for name, bit in _TCP_FLAGS if value & bit) or "none"


def _layer(packet: Packet, name: str) -> None:
    if name not in packet.layers:
        packet.layers.append(name)


def _decode(packet: Packet) -> None:
    data = packet.data
    if len(data) < 14:
        raise ValueError("short frame")
    dst, src = _mac(data[0:6]), _mac(data[6:12])
    packet.src, packet.dst = src, dst
    ethertype, offset = struct.unpack("!H", data[12:14])[0], 14
    _layer(packet, "Ethernet")
    while ethertype in (0x8100, 0x88A8):  # 802.1Q / QinQ: outermost tag is the one reported
        tci, ethertype = struct.unpack("!HH", data[offset : offset + 4])
        packet.vlan = tci & 0x0FFF if packet.vlan is None else packet.vlan
        _layer(packet, "VLAN")
        offset += 4
    if ethertype <= 1500:  # 802.3 length: LLC (STP, IS-IS, CDP...)
        _decode_llc(packet, data[offset:])
        return
    body = data[offset:]
    if ethertype == 0x0806:
        _decode_arp(packet, body)
    elif ethertype == 0x0800:
        _decode_ipv4(packet, body)
    elif ethertype == 0x86DD:
        _decode_ipv6(packet, body)
    elif ethertype in (0x8847, 0x8848):
        _decode_mpls(packet, body)
    elif ethertype == 0x88CC:
        _decode_lldp(packet, body)
    elif ethertype == 0x8809:
        packet.proto = "LACP" if body[:1] == b"\x01" else "Slow-protocol"
        packet.info = "LACPDU" if body[:1] == b"\x01" else f"subtype {body[0]}"
    else:
        packet.proto = _ETHERTYPES.get(ethertype, "Ethernet")
        packet.info = f"ethertype 0x{ethertype:04x}"


def _decode_llc(packet: Packet, llc: bytes) -> None:
    _layer(packet, "LLC")
    # The 802.3 length field sits before the LLC header; `llc` starts after it, so skip nothing.
    if len(llc) < 3:
        raise ValueError("short LLC")
    dsap, ssap = llc[0], llc[1]
    if dsap == 0x42 and ssap == 0x42:
        flags = llc[3 + 4] if len(llc) > 7 else 0
        kind = {0: "STP configuration", 0x80: "STP TCN"}.get(llc[6] if len(llc) > 6 else 0, "STP")
        packet.proto, packet.info = "STP", kind + (" (topology change)" if flags & 0x01 else "")
    elif dsap == 0xFE and ssap == 0xFE:  # ISO CLNP: IS-IS rides here
        pdu = llc[3 + 4] & 0x1F if len(llc) > 7 else 0
        packet.proto, packet.info = "IS-IS", _ISIS.get(pdu, f"PDU type {pdu}")
    elif dsap == 0xAA and ssap == 0xAA and len(llc) >= 8 and llc[3:6] == b"\x00\x00\x0c":
        packet.proto, packet.info = "CDP" if llc[6:8] == b"\x20\x00" else "Cisco-SNAP", "Cisco discovery"
    else:
        packet.proto, packet.info = "LLC", f"dsap 0x{dsap:02x} ssap 0x{ssap:02x}"


def _decode_arp(packet: Packet, body: bytes) -> None:
    op = struct.unpack("!H", body[6:8])[0]
    smac, sip = _mac(body[8:14]), str(ipaddress.IPv4Address(body[14:18]))
    tip = str(ipaddress.IPv4Address(body[24:28]))
    packet.proto, packet.src = "ARP", sip
    if op == 1:
        packet.info = f"who has {tip}? tell {sip}" + (" (gratuitous)" if sip == tip else "")
        packet.dst = tip
    elif op == 2:
        packet.info, packet.dst = f"{sip} is at {smac}", tip
    else:
        packet.info = f"opcode {op}"


def _decode_lldp(packet: Packet, body: bytes) -> None:
    packet.proto = "LLDP"
    fields: dict[int, bytes] = {}
    offset = 0
    while offset + 2 <= len(body):
        header = struct.unpack("!H", body[offset : offset + 2])[0]
        kind, length = header >> 9, header & 0x1FF
        if kind == 0:
            break
        fields[kind] = body[offset + 2 : offset + 2 + length]
        offset += 2 + length
    name = fields.get(5, b"").decode(errors="replace")
    port = fields.get(2, b"")[1:].decode(errors="replace")
    packet.info = f"system {name or '?'} port {port or '?'}"


def _decode_mpls(packet: Packet, body: bytes) -> None:
    labels, offset = [], 0
    while offset + 4 <= len(body):
        entry = struct.unpack("!I", body[offset : offset + 4])[0]
        labels.append(entry >> 12)
        offset += 4
        if entry & 0x100:
            break
    _layer(packet, "MPLS")
    inner = body[offset:]
    stack = "/".join(str(label) for label in labels)
    if inner[:1] and inner[0] >> 4 == 4:
        _decode_ipv4(packet, inner)
    elif inner[:1] and inner[0] >> 4 == 6:
        _decode_ipv6(packet, inner)
    else:
        packet.proto = "MPLS"
    packet.info = f"[MPLS {stack}] {packet.info}".strip()


def _decode_ipv4(packet: Packet, ip: bytes) -> None:
    ihl = (ip[0] & 0x0F) * 4
    total, ttl, proto = struct.unpack("!H", ip[2:4])[0], ip[8], ip[9]
    frag = struct.unpack("!H", ip[6:8])[0]
    packet.src, packet.dst = str(ipaddress.IPv4Address(ip[12:16])), str(ipaddress.IPv4Address(ip[16:20]))
    _layer(packet, "IPv4")
    if frag & 0x1FFF:
        packet.proto, packet.info = (
            "IPv4",
            f"fragment at offset {(frag & 0x1FFF) * 8} of {_IP_PROTOS.get(proto, proto)}",
        )
        return
    payload = ip[ihl : max(total, ihl)] if total >= ihl else ip[ihl:]
    _decode_transport(packet, proto, payload, ttl, v6=False)


def _decode_ipv6(packet: Packet, ip: bytes) -> None:
    nxt, hop = ip[6], ip[7]
    packet.src, packet.dst = str(ipaddress.IPv6Address(ip[8:24])), str(ipaddress.IPv6Address(ip[24:40]))
    _layer(packet, "IPv6")
    offset = 40
    while nxt in (0, 43, 60) and offset + 8 <= len(ip):  # hop-by-hop, routing, destination options
        nxt, extension = ip[offset], (ip[offset + 1] + 1) * 8
        offset += extension
    if nxt == 44:
        packet.proto, packet.info = "IPv6", "fragment"
        return
    _decode_transport(packet, nxt, ip[offset:], hop, v6=True)


def _decode_transport(packet: Packet, proto: int, payload: bytes, ttl: int, *, v6: bool) -> None:
    if proto == 6:
        _decode_tcp(packet, payload)
    elif proto == 17:
        _decode_udp(packet, payload)
    elif proto == 1 and not v6:
        _decode_icmp(packet, payload)
    elif proto == 58:
        _decode_icmp6(packet, payload)
    elif proto == 89:
        _decode_ospf(packet, payload)
    elif proto == 112:
        version, kind, vrid, prio = payload[0] >> 4, payload[0] & 0x0F, payload[1], payload[2]
        packet.proto = "VRRP"
        packet.info = f"v{version} {'advertisement' if kind == 1 else f'type {kind}'} vrid {vrid} priority {prio}"
    elif proto == 47:
        packet.proto, packet.info = "GRE", f"protocol 0x{struct.unpack('!H', payload[2:4])[0]:04x}"
        _layer(packet, "GRE")
    elif proto == 103:
        packet.proto, packet.info = (
            "PIM",
            {0: "Hello", 3: "Join/Prune", 4: "Bootstrap"}.get(payload[0] & 0x0F, "message"),
        )
    elif proto == 2:
        packet.proto, packet.info = (
            "IGMP",
            {0x11: "query", 0x16: "v2 report", 0x22: "v3 report", 0x17: "leave"}.get(payload[0], f"type {payload[0]}"),
        )
    else:
        packet.proto = _IP_PROTOS.get(proto, f"IP-{proto}")
        packet.info = f"ttl {ttl}"


def _decode_icmp(packet: Packet, icmp: bytes) -> None:
    kind, code = icmp[0], icmp[1]
    packet.proto = "ICMP"
    packet.info = _ICMP.get(kind, f"type {kind}")
    if kind == 3:
        packet.info += f" ({_ICMP_UNREACH.get(code, f'code {code}')})"
        packet.notes.append("unreachable")
    elif kind == 11:
        packet.notes.append("ttl-exceeded")
    elif kind in (8, 0) and len(icmp) >= 8:
        ident, seq = struct.unpack("!HH", icmp[4:8])
        packet.info += f" id {ident} seq {seq}"


def _decode_icmp6(packet: Packet, icmp: bytes) -> None:
    kind = icmp[0]
    packet.proto = "ICMPv6"
    packet.info = _ICMP6.get(kind, f"type {kind}")
    if kind in (135, 136) and len(icmp) >= 24:
        packet.info += f" for {ipaddress.IPv6Address(icmp[8:24])}"
    if kind == 1:
        packet.notes.append("unreachable")


def _decode_ospf(packet: Packet, ospf: bytes) -> None:
    version, kind = ospf[0], ospf[1]
    router, area = str(ipaddress.IPv4Address(ospf[4:8])), str(ipaddress.IPv4Address(ospf[8:12]))
    packet.proto = "OSPF" if version == 2 else "OSPFv3"
    packet.info = f"{_OSPF.get(kind, f'type {kind}')} router-id {router} area {area}"
    if kind == 1 and version == 2 and len(ospf) >= 44:
        hello, dead = struct.unpack("!H", ospf[28:30])[0], struct.unpack("!I", ospf[32:36])[0]
        packet.info += f" (hello {hello}s, dead {dead}s)"


def _decode_tcp(packet: Packet, tcp: bytes) -> None:
    sport, dport, seq, ack = struct.unpack("!HHII", tcp[:12])
    offset = (tcp[12] >> 4) * 4
    flags, window = tcp[13], struct.unpack("!H", tcp[14:16])[0]
    packet.sport, packet.dport = sport, dport
    payload = tcp[offset:]
    packet.proto = _TCP_PORTS.get(dport) or _TCP_PORTS.get(sport) or "TCP"
    _layer(packet, "TCP")
    packet.info = f"{sport} → {dport} [{_flags(flags)}] seq {seq} ack {ack} win {window} len {len(payload)}"
    if flags & 0x04:
        packet.notes.append("rst")
    if flags & 0x12 == 0x12:
        packet.notes.append("synack")
    elif flags & 0x02:
        packet.notes.append("syn")
    if packet.proto == "BGP" and len(payload) >= 19 and payload[:16] == b"\xff" * 16:
        kind = payload[18]
        packet.info = f"{_BGP.get(kind, f'type {kind}')} ({packet.info})"
        if kind == 3:
            code, sub = payload[19], payload[20] if len(payload) > 20 else 0
            packet.info = f"NOTIFICATION code {code}/{sub} ({sport} → {dport})"
            packet.notes.append("bgp-notification")
    elif packet.proto in ("HTTP", "HTTPS", "SSH", "Telnet", "TCP", "DNS") and payload[:4] in (
        b"GET ",
        b"POST",
        b"HTTP",
        b"PUT ",
        b"HEAD",
    ):
        packet.proto = "HTTP"
        request_line = payload.split(b"\r\n", 1)[0][:80].decode(errors="replace")
        packet.info += f" {request_line}"


def _decode_udp(packet: Packet, udp: bytes) -> None:
    sport, dport, length = struct.unpack("!HHH", udp[:6])
    packet.sport, packet.dport = sport, dport
    payload = udp[8:length] if length >= 8 else udp[8:]
    packet.proto = _UDP_PORTS.get(dport) or _UDP_PORTS.get(sport) or "UDP"
    _layer(packet, "UDP")
    packet.info = f"{sport} → {dport} len {len(payload)}"
    if packet.proto == "DHCP" and len(payload) > 240 and payload[236:240] == b"\x63\x82\x53\x63":
        packet.info = f"{_dhcp_type(payload)} xid 0x{struct.unpack('!I', payload[4:8])[0]:08x}"
    elif packet.proto == "DNS" and len(payload) >= 12:
        packet.info = _dns(payload)
    elif packet.proto == "VXLAN" and len(payload) >= 8:
        vni = struct.unpack("!I", payload[4:8])[0] >> 8
        packet.info = f"VNI {vni}"
        _layer(packet, "VXLAN")
        inner = Packet(0, 0, len(payload) - 8, payload[8:])
        try:
            _decode(inner)
            packet.info += f" inner {inner.proto} {inner.src} → {inner.dst} {inner.info}"
        except (struct.error, IndexError, ValueError):
            packet.notes.append("inner frame truncated")
    elif packet.proto == "BFD" and len(payload) >= 24:
        state = _BFD_STATE.get((payload[1] >> 6) & 3, "?")
        packet.info = f"control state {state} diag {payload[0] & 0x1F}"
    elif packet.proto == "LDP" and len(payload) >= 12:
        packet.info = f"{_LDP.get(struct.unpack('!H', payload[10:12])[0] & 0x7FFF, 'message')}"
    elif packet.proto == "UDP" and 33434 <= dport <= 33534:
        packet.proto, packet.info = "traceroute", f"probe to port {dport}"


def _dhcp_type(payload: bytes) -> str:
    options, offset = payload[240:], 0
    while offset + 2 <= len(options) and options[offset] != 255:
        code = options[offset]
        if code == 0:
            offset += 1
            continue
        length = options[offset + 1]
        if code == 53 and length >= 1:
            return _DHCP.get(options[offset + 2], "message")
        offset += 2 + length
    return "BOOTP"


def _dns(payload: bytes) -> str:
    flags, questions = struct.unpack("!HH", payload[2:6])
    name, offset = [], 12
    while offset < len(payload) and payload[offset]:
        length = payload[offset]
        name.append(payload[offset + 1 : offset + 1 + length].decode(errors="replace"))
        offset += length + 1
    kind = "response" if flags & 0x8000 else "query"
    return f"{kind} {'.'.join(name) or '?'}" + ("" if questions else " (no question)")


# -------------------------------------------------------------- analysis
def conversations(packets: list[Packet], top: int = 10) -> list[dict[str, Any]]:
    """Bidirectional flows (addresses+ports) ranked by bytes."""
    flows: dict[tuple, dict[str, Any]] = {}
    for packet in packets:
        ends = sorted([(packet.src, packet.sport or 0), (packet.dst, packet.dport or 0)])
        key = (packet.proto, *ends[0], *ends[1])
        flow = flows.setdefault(
            key,
            {
                "proto": packet.proto, "a": _end(*ends[0]), "b": _end(*ends[1]),
                "packets": 0, "bytes": 0, "first": round(packet.time, 3), "last": 0.0,
            },
        )  # fmt: skip
        flow["packets"] += 1
        flow["bytes"] += packet.length
        flow["last"] = round(packet.time, 3)
    return sorted(flows.values(), key=lambda f: f["bytes"], reverse=True)[:top]


def _end(addr: str, port: int) -> str:
    return f"{addr}:{port}" if port else addr


def summarize(packets: list[Packet]) -> dict[str, Any]:
    """What a capture contains and what looks wrong in it."""
    if not packets:
        return {"packets": 0}
    protos = Counter(p.proto for p in packets)
    infos = Counter(f"{p.proto}: {p.info.split(' (')[0]}" for p in packets if p.proto in _CONTROL)
    notes = Counter(note for p in packets for note in p.notes)
    findings: list[str] = []
    if notes["rst"]:
        findings.append(f"{notes['rst']} TCP reset(s): a connection was refused or torn down")
    if notes["syn"] > 3 and not notes["synack"]:
        findings.append(f"{notes['syn']} TCP SYN(s) with no SYN-ACK: nothing is answering")
    if notes["unreachable"]:
        findings.append(
            f"{notes['unreachable']} ICMP destination-unreachable message(s): a router has no route or port"
        )
    if notes["ttl-exceeded"]:
        findings.append(f"{notes['ttl-exceeded']} ICMP time-exceeded: a forwarding loop or a traceroute")
    if notes["bgp-notification"]:
        findings.append(f"{notes['bgp-notification']} BGP NOTIFICATION(s): a session was torn down -- see the codes")
    arp_requests = [p for p in packets if p.proto == "ARP" and p.info.startswith("who has")]
    answered = {p.src for p in packets if p.proto == "ARP" and " is at " in p.info}
    unanswered = sorted({p.dst for p in arp_requests} - answered)
    if unanswered:
        findings.append(f"ARP asked for {', '.join(unanswered[:5])} and never got an answer")
    duration = packets[-1].time
    return {
        "packets": len(packets),
        "bytes": sum(p.length for p in packets),
        "seconds": round(duration, 3),
        "protocols": dict(protos.most_common()),
        "control_plane": dict(infos.most_common(12)),
        "top_conversations": conversations(packets),
        "findings": findings,
    }


_CONTROL = {
    "OSPF",
    "OSPFv3",
    "BGP",
    "BFD",
    "LDP",
    "IS-IS",
    "VRRP",
    "LLDP",
    "LACP",
    "STP",
    "PIM",
    "IGMP",
    "RIP",
    "HSRP",
    "DHCP",
    "ICMPv6",
}


def matches(packet: Packet, expression: str) -> bool:
    """Tiny display filter: space-separated terms, all must hold. ``proto`` names
    (``bgp``, ``ospf``, ``icmp``...), ``host <addr>``, ``port <n>``, ``vlan <n>``,
    ``not <term>``; any other word must appear in the summary line."""
    terms = expression.split()
    index = 0
    while index < len(terms):
        term = terms[index].lower()
        negate = term == "not" and index + 1 < len(terms)
        if negate:
            index += 1
            term = terms[index].lower()
        if term in ("host", "port", "vlan") and index + 1 < len(terms):
            value = terms[index + 1]
            index += 1
            if term == "host":
                ok = value in (packet.src, packet.dst)
            elif term == "port":
                ok = value.isdigit() and int(value) in (packet.sport, packet.dport)
            else:
                ok = value.isdigit() and packet.vlan == int(value)
        elif term == packet.proto.lower() or term in (layer.lower() for layer in packet.layers):
            ok = True
        else:
            ok = term in packet.line().lower()
        if ok == negate:
            return False
        index += 1
    return True


def detail(packet: Packet) -> dict[str, Any]:
    """Everything known about one packet, with a hex dump of the frame (first 256 B)."""
    return {**packet.as_dict(), "notes": packet.notes, "hex": hexdump(packet.data[:256])}


def hexdump(data: bytes) -> str:
    lines = []
    for offset in range(0, len(data), 16):
        chunk = data[offset : offset + 16]
        text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"{offset:04x}  {chunk.hex(' '):<47}  {text}")
    return "\n".join(lines)
