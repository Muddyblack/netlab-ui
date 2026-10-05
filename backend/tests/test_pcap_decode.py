"""The dependency-free pcap decoder (services.netlab.pcap_decode) and the capture tools."""

from __future__ import annotations

import asyncio
import ipaddress
import struct

import pytest

from app.sessions.store import store
from services.assistant import packets as packet_tools
from services.assistant.tools import ToolError
from services.netlab import pcap_decode as pd

A, B = "02:00:00:00:00:01", "02:00:00:00:00:02"


def mac(text: str) -> bytes:
    return bytes(int(part, 16) for part in text.split(":"))


def eth(payload: bytes, ethertype: int, dst: str = B, src: str = A, vlan: int | None = None) -> bytes:
    tag = struct.pack("!HH", 0x8100, vlan) if vlan is not None else b""
    return mac(dst) + mac(src) + tag + struct.pack("!H", ethertype) + payload


def ipv4(payload: bytes, proto: int, src: str = "10.0.0.1", dst: str = "10.0.0.2") -> bytes:
    header = struct.pack(
        "!BBHHHBBH4s4s", 0x45, 0, 20 + len(payload), 0, 0, 64, proto, 0,
        ipaddress.IPv4Address(src).packed, ipaddress.IPv4Address(dst).packed,
    )  # fmt: skip
    return header + payload


def tcp(sport: int, dport: int, flags: int, payload: bytes = b"") -> bytes:
    return struct.pack("!HHIIBBHHH", sport, dport, 1, 0, 5 << 4, flags, 1000, 0, 0) + payload


def udp(sport: int, dport: int, payload: bytes) -> bytes:
    return struct.pack("!HHHH", sport, dport, 8 + len(payload), 0) + payload


def arp(op: int, smac: str, sip: str, tip: str) -> bytes:
    return struct.pack("!HHBBH6s4s6s4s", 1, 0x0800, 6, 4, op, mac(smac), ipaddress.IPv4Address(sip).packed,
                       b"\0" * 6, ipaddress.IPv4Address(tip).packed)  # fmt: skip


def pcap(*frames: bytes) -> bytes:
    out = struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
    for index, frame in enumerate(frames):
        out += struct.pack("<IIII", 100 + index, 0, len(frame), len(frame)) + frame
    return out


def decode(*frames: bytes) -> list[pd.Packet]:
    return pd.read_packets(pcap(*frames))[0]


def test_decodes_the_basics():
    ping = eth(ipv4(struct.pack("!BBHHH", 8, 0, 0, 7, 3), 1), 0x0800)
    syn = eth(ipv4(tcp(40000, 22, 0x02), 6), 0x0800)
    ask = eth(arp(1, A, "10.0.0.1", "10.0.0.9"), 0x0806, dst="ff:ff:ff:ff:ff:ff")
    got = decode(ping, syn, ask)
    assert (got[0].proto, got[0].info) == ("ICMP", "echo request id 7 seq 3")
    assert got[1].proto == "SSH" and "[S]" in got[1].info and got[1].dport == 22
    assert (got[2].proto, got[2].info) == ("ARP", "who has 10.0.0.9? tell 10.0.0.1")
    assert got[1].time == pytest.approx(1.0)


def test_vlan_and_routing_protocols():
    ospf = struct.pack("!BBHIIHHQ", 2, 1, 44, 0x01010101, 0, 0, 0, 0) + struct.pack(
        "!IHBBIII", 0xFFFFFF00, 10, 0, 1, 40, 0, 0
    )
    hello = decode(eth(ipv4(ospf, 89, dst="224.0.0.5"), 0x0800, vlan=10))[0]
    assert hello.proto == "OSPF" and "Hello" in hello.info and "1.1.1.1" in hello.info and hello.vlan == 10
    bgp = b"\xff" * 16 + struct.pack("!HBBB", 21, 3, 6, 2)
    notification = decode(eth(ipv4(tcp(179, 50000, 0x18, bgp), 6), 0x0800))[0]
    assert notification.proto == "BGP" and "NOTIFICATION code 6/2" in notification.info
    assert "bgp-notification" in notification.notes


def test_vxlan_is_unwrapped():
    inner = eth(ipv4(struct.pack("!BBHHH", 8, 0, 0, 1, 1), 1, "192.168.1.1", "192.168.1.2"), 0x0800)
    vxlan = struct.pack("!II", 0x08000000, 5000 << 8) + inner
    packet = decode(eth(ipv4(udp(55555, 4789, vxlan), 17), 0x0800))[0]
    assert packet.proto == "VXLAN" and "VNI 5000" in packet.info and "192.168.1.1" in packet.info


def test_garbage_is_listed_not_fatal():
    packets = decode(b"\x00" * 10, eth(b"\x45", 0x0800), eth(b"abc", 0x1234))
    assert [p.proto for p in packets][2] == "Ethernet" and packets[0].proto == "Malformed"


def test_findings_name_what_is_wrong():
    frames = [eth(arp(1, A, "10.0.0.1", "10.0.0.9"), 0x0806)] * 2
    frames += [eth(ipv4(tcp(40000 + i, 80, 0x02), 6), 0x0800) for i in range(5)]
    frames += [eth(ipv4(tcp(80, 40000, 0x04), 6, "10.0.0.2", "10.0.0.1"), 0x0800)]
    summary = pd.summarize(decode(*frames))
    text = " ".join(summary["findings"])
    assert "never got an answer" in text and "SYN" in text and "reset" in text
    assert summary["packets"] == 8 and summary["protocols"]["ARP"] == 2


def test_filter_expressions():
    packets = decode(
        eth(ipv4(tcp(179, 50000, 0x10), 6), 0x0800),
        eth(arp(1, A, "10.0.0.1", "10.0.0.9"), 0x0806),
        eth(ipv4(tcp(1, 22, 0x10), 6, "10.9.9.9", "10.0.0.2"), 0x0800, vlan=20),
    )
    pick = lambda expression: [p.number for p in packets if pd.matches(p, expression)]  # noqa: E731
    assert pick("bgp") == [1] and pick("arp") == [2] and pick("not arp") == [1, 3]
    assert pick("host 10.9.9.9") == [3] and pick("port 179") == [1] and pick("vlan 20") == [3]
    assert pick("tcp host 10.0.0.1") == [1]


def test_rejects_what_it_cannot_read():
    with pytest.raises(pd.PcapError, match="not a pcap"):
        pd.read_packets(b"x" * 40)
    with pytest.raises(pd.PcapError, match="pcapng"):
        pd.read_packets(b"\x0a\x0d\x0d\x0a" + b"\0" * 40)
    sll = struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 113)
    with pytest.raises(pd.PcapError, match="Ethernet"):
        pd.read_packets(sll)


def test_hexdump_and_detail():
    packet = decode(eth(b"\0\0hello", 0x1234))[0]
    assert "68 65 6c 6c 6f" in pd.detail(packet)["hex"]


# ----------------------------------------------------------------- the tools
@pytest.fixture
def session(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text("name: demo\nnodes:\n  r1:\n    device: frr\n")
    created = store.create(str(path))
    yield created
    store.delete(created.id)


def test_read_capture_lists_pages_and_extracts(session, tmp_path):
    assert asyncio.run(packet_tools.read_capture()) == {"captures": []}
    (tmp_path / "captures").mkdir()
    frames = [eth(arp(1, A, "10.0.0.1", f"10.0.0.{n}"), 0x0806) for n in range(2, 8)]
    (tmp_path / "captures" / "r1-eth1.pcap").write_bytes(pcap(*frames))
    assert [c["file"] for c in asyncio.run(packet_tools.read_capture())["captures"]] == ["r1-eth1.pcap"]
    page = asyncio.run(packet_tools.read_capture("r1-eth1.pcap", limit=2, offset=1))
    assert page["matching"] == 6 and page["shown"] == 2 and "offset=3" in page["more"]
    assert page["packets"].startswith("UNTRUSTED") and "#2 " in page["packets"]
    one = asyncio.run(packet_tools.read_capture("r1-eth1.pcap", packet=1))
    assert "who has 10.0.0.2" in one["packet"] and "hex" in one["packet"]
    with pytest.raises(ToolError, match="outside"):
        asyncio.run(packet_tools.read_capture("r1-eth1.pcap", packet=99))


@pytest.mark.parametrize("name", ["../topology.yml", "../../etc/passwd", "a/b.pcap", "x.txt", "missing.pcap"])
def test_read_capture_stays_in_captures(session, name):
    with pytest.raises(ToolError):
        asyncio.run(packet_tools.read_capture(name))


class _Stream:
    def __init__(self, data: bytes):
        self._data = data

    async def read(self, _n: int) -> bytes:
        data, self._data = self._data, b""
        return data


class _Proc:
    returncode = 0

    def __init__(self, body: bytes):
        self.stdout = _Stream(body)

    async def wait(self) -> int:
        return 0


def test_capture_packets_saves_and_decodes(session, tmp_path, monkeypatch):
    from app.lab import pcap as pcap_routes

    stream = pcap(eth(ipv4(struct.pack("!BBHHH", 8, 0, 0, 1, 1), 1), 0x0800))

    async def fake(topology, node, interface, seconds, max_packets):
        assert (node, interface, seconds, max_packets) == ("r1", "eth1", 5, 2000)
        return _Proc(stream[24:]), stream[:24]

    monkeypatch.setattr(pcap_routes, "start_capture", fake)
    result = asyncio.run(packet_tools.capture_packets("r1", "eth1"))
    assert result["summary"]["packets"] == 1 and result["summary"]["protocols"] == {"ICMP": 1}
    assert (tmp_path / "captures" / result["file"]).read_bytes() == stream
    assert "echo request" in result["packets"]
