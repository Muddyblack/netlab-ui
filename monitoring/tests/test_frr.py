import os

from nlmon import frr
from nlmon.metrics import Sink, render

RESOLVER = frr.Resolver(
    {"10.0.0.2": "r2", "10.1.0.10": "r3", "10.1.0.2": "r2"},
    {"10.0.0.2": "r2", "10.0.0.3": "r3"},
    {"r1", "r2", "r3", "h1"},
)
IFMAP = {"eth1": {"ifname": "eth1", "link": "r1-r2", "peer_node": "r2"}}


def samples(sink, name):
    return [(labels, value) for n, labels, value in sink.samples if n == name]


def fake_query(outputs):
    def query(path, commands):
        return [outputs[c] for c in commands]

    return query


def test_collect_from_captured_frr_replies(tmp_path, frr_outputs):
    rundir = tmp_path / "run" / "frr"
    rundir.mkdir(parents=True)
    for daemon in ("ospfd", "isisd", "bgpd", "bfdd", "zebra"):
        (rundir / f"{daemon}.vty").touch()
    outputs = dict(frr_outputs["r1"])
    outputs.setdefault("show ipv6 route summary json", "{}")
    sink = Sink({"node": "r1"})
    ok = frr.collect(
        sink, str(tmp_path), ["ospf", "isis", "bgp", "bfd"], ["run/frr"], RESOLVER, IFMAP, query=fake_query(outputs)
    )
    assert ok
    bgp = {labels["peer"]: (labels["peer_node"], value) for labels, value in samples(sink, "netlab_bgp_session_up")}
    assert bgp == {"10.0.0.2": ("r2", 1), "10.1.0.10": ("r3", 1)}
    ospf = samples(sink, "netlab_ospf_neighbor_state")
    assert ospf[0][0]["peer_node"] == "r2" and ospf[0][0]["ifname"] == "eth1" and ospf[0][1] == 8
    assert samples(sink, "netlab_ospf_neighbor_changes_total")[0][1] == 5
    isis = samples(sink, "netlab_isis_adjacency_up")
    assert isis[0][0]["peer_node"] == "r2" and isis[0][1] == 1
    assert samples(sink, "netlab_isis_adjacency_changes_total")[0][1] == 1
    assert samples(sink, "netlab_ospf_spf_runs_total")
    assert any(lbl["protocol"] == "ospf" and lbl["table"] == "rib" for lbl, _ in samples(sink, "netlab_routes"))
    prefixes = samples(sink, "netlab_bgp_prefixes_received")
    assert {(lbl["afi"], lbl["safi"]) for lbl, _ in prefixes} == {("ipv4", "unicast")}
    text = render([sink])
    assert "# TYPE netlab_bgp_session_up gauge" in text


def test_missing_daemons_are_skipped(tmp_path, frr_outputs):
    rundir = tmp_path / "run" / "frr"
    rundir.mkdir(parents=True)
    (rundir / "bgpd.vty").touch()  # r3 runs no ospfd/isisd
    sink = Sink()
    assert frr.collect(
        sink, str(tmp_path), ["ospf", "bgp"], ["run/frr"], RESOLVER, {}, query=fake_query(frr_outputs["r3"])
    )
    assert not samples(sink, "netlab_ospf_neighbor_state")
    assert len(samples(sink, "netlab_bgp_session_up")) == 2


def test_no_rundir_means_not_collected(tmp_path):
    assert not frr.collect(Sink(), str(tmp_path), ["bgp"], ["run/frr"], RESOLVER, {})


def test_bfd_peers_and_counters():
    peers = [
        {"peer": "10.1.0.2", "interface": "eth1", "vrf": "default", "status": "up"},
        {"peer": "10.1.0.10", "interface": "eth2", "vrf": "default", "status": "down"},
    ]
    counters = [{"peer": "10.1.0.2", "interface": "eth1", "vrf": "default", "session-down": 3}]
    sink = Sink()
    frr.bfd_peers(sink, peers, counters, RESOLVER, IFMAP)
    up = {lbl["peer"]: v for lbl, v in samples(sink, "netlab_bfd_session_up")}
    assert up == {"10.1.0.2": 1, "10.1.0.10": 0}
    assert samples(sink, "netlab_bfd_session_down_total")[0][1] == 3


def test_parse_duration():
    assert frr.parse_duration("51s") == 51
    assert frr.parse_duration("1m02s") == 62
    assert frr.parse_duration("00:01:02") == 62
    assert frr.parse_duration("1d02:00:00") == 86400 + 7200
    assert frr.parse_duration("2d03h04m") == 2 * 86400 + 3 * 3600 + 240
    assert frr.parse_duration("never") is None


def test_real_vty_socket_protocol(tmp_path):
    """The client speaks FRR's vty framing: NUL-terminated command, reply + 3 NULs + status."""
    import socket
    import threading

    path = str(tmp_path / "zebra.vty")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    server.listen(1)

    received = []

    def serve():
        conn, _ = server.accept()
        for reply in (b"", b'{"routes":[]}'):  # 'enable', then the show command
            buf = b""
            while not buf.endswith(b"\0"):
                buf += conn.recv(1024)
            received.append(buf[:-1].decode())
            conn.sendall(reply + b"\0\0\0\0")
        conn.close()

    thread = threading.Thread(target=serve)
    thread.start()
    assert frr.vty_query(path, ["show ip route summary json"]) == ['{"routes":[]}']
    thread.join()
    server.close()
    assert received == ["enable", "show ip route summary json"]
    assert os.path.exists(path)
