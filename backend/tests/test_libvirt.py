"""libvirt provider support, against a fake ``virsh`` on PATH and a fake sysfs.

The fake answers ``domiflist`` like a netlab VM with a management NIC, one
point-to-point link (a UDP tunnel: no host tap) and one LAN link (tap
``vnet7`` on libvirt network ``lab_1``), and logs every other call.
"""

import asyncio
import os
import stat
import sys

import pytest
from fastapi.testclient import TestClient

from app.lab import pcap
from app.main import app
from app.sessions.store import store
from services.model.topology import Topology
from services.netlab import libvirt, runner, runtime

DOMIFLIST = """\
 Interface   Type      Source       Model    MAC
-----------------------------------------------------------
 vnet3       network   vagrant-libvirt virtio   52:54:00:00:00:01
 -           udp       127.1.1.1    virtio   52:54:00:00:00:02
 vnet7       network   lab_1        virtio   52:54:00:00:00:03
"""

VM_NODE = {
    "name": "r1",
    "device": "eos",
    "interfaces": [
        {"ifname": "Loopback0", "type": "loopback"},
        {"ifname": "Ethernet1", "type": "p2p"},
        {"ifname": "Vlan10", "virtual_interface": True},
        {"ifname": "Ethernet2", "type": "lan", "bridge": "lab_1"},
    ],
}


@pytest.fixture
def fake_virsh(tmp_path, monkeypatch):
    log = tmp_path / "virsh.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "virsh"
    script.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        f"open({str(log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
        "cmd = sys.argv[1]\n"
        f"if cmd == 'domiflist': sys.stdout.write({DOMIFLIST!r})\n"
        "elif cmd == 'domif-getlink':\n"
        "    print(sys.argv[3] + ' ' + ('down' if sys.argv[3].endswith('02') else 'up'))\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")

    sysfs = tmp_path / "sys"
    counters = sysfs / "vnet7" / "statistics"
    counters.mkdir(parents=True)
    for name, value in {"rx_bytes": 1000, "tx_bytes": 5000, "rx_packets": 10, "tx_packets": 50}.items():
        (counters / name).write_text(f"{value}\n")
    (sysfs / "vnet7" / "operstate").write_text("up\n")
    monkeypatch.setattr(libvirt, "SYSFS_NET", sysfs)
    return log


def test_domain_names_follow_netlab():
    assert libvirt.domain_name("lab.yml", "r1") == "lab_r1"


def test_domiflist_rows_map_to_netlab_interfaces_skipping_mgmt_loopbacks_and_virtual():
    ifaces = libvirt.map_interfaces(libvirt.parse_domiflist(DOMIFLIST), VM_NODE)
    assert [(i.ifname, i.target, i.mac, i.bridge) for i in ifaces] == [
        ("Ethernet1", None, "52:54:00:00:00:02", None),
        ("Ethernet2", "vnet7", "52:54:00:00:00:03", "lab_1"),
    ]


def test_tap_counters_are_reported_from_the_vms_side(fake_virsh):
    counters = libvirt.host_counters("vnet7")
    # The host received 1000 bytes on the tap — the VM sent them.
    assert counters["stats64"]["tx"]["bytes"] == 1000
    assert counters["stats64"]["rx"]["bytes"] == 5000
    assert counters["operstate"] == "up"


def test_runtime_interfaces_have_link_state_for_all_and_counters_for_lan(fake_virsh):
    raw = asyncio.run(libvirt.runtime_interfaces("lab_r1", VM_NODE))
    assert [(r["ifname"], r["operstate"], "stats64" in r) for r in raw] == [
        ("Ethernet1", "down", False),
        ("Ethernet2", "up", True),
    ]


def test_node_actions_map_to_virsh(fake_virsh):
    for action in ("start", "stop", "restart", "pause", "unpause"):
        assert asyncio.run(libvirt.node_action("lab_r1", action)).code == 0
    assert asyncio.run(libvirt.node_action("lab_r1", "save")).code == 2
    calls = fake_virsh.read_text().splitlines()
    assert calls == ["start lab_r1", "shutdown lab_r1", "reboot lab_r1", "suspend lab_r1", "resume lab_r1"]


def test_set_link_addresses_the_nic_by_mac_even_for_tunnels(fake_virsh):
    assert asyncio.run(libvirt.set_link("lab_r1", VM_NODE, "Ethernet1", False)).code == 0
    assert "domif-setlink lab_r1 52:54:00:00:00:02 down" in fake_virsh.read_text()
    missing = asyncio.run(libvirt.set_link("lab_r1", VM_NODE, "Ethernet9", True))
    assert missing.code == 1 and "no interface Ethernet9" in missing.stderr


def test_capture_uses_the_lan_tap_and_explains_tunnels(fake_virsh):
    assert asyncio.run(libvirt.capture_interface("lab_r1", VM_NODE, "Ethernet2")) == "vnet7"
    with pytest.raises(ValueError, match="UDP tunnels"):
        asyncio.run(libvirt.capture_interface("lab_r1", VM_NODE, "Ethernet1"))


@pytest.fixture
def vm_lab(tmp_path, monkeypatch, fake_virsh):
    path = tmp_path / "topology.yml"
    path.write_text("name: lab\nprovider: libvirt\nnodes: [r1, ext]\n")

    async def status_for(_path, **_kwargs):
        return {
            "nodes": {
                "r1": {"provider": "libvirt", "provider_name": "lab_r1", "status": "running"},
                "ext": {"provider": "external", "status": "running"},
            }
        }

    async def create(_path, **_kwargs):
        return {"snapshot": {"name": "lab", "provider": "libvirt", "nodes": {"r1": VM_NODE, "ext": {"name": "ext"}}}}

    monkeypatch.setattr(runner, "status_for", status_for)
    monkeypatch.setattr(runner, "create", create)
    return path, store.create(str(path)).id


def test_runtime_collect_reports_vm_interfaces(vm_lab):
    path, _sid = vm_lab
    runtime._counter_cache.clear()
    containers = asyncio.run(runtime.collect(path, Topology(name="lab")))
    r1 = next(c for c in containers if c["nodeName"] == "r1")
    assert r1["provider"] == "libvirt" and r1["state"] == "running"
    assert [i["name"] for i in r1["interfaces"]] == ["Ethernet1", "Ethernet2"]
    ext = next(c for c in containers if c["nodeName"] == "ext")
    assert ext["provider"] == "external" and ext["interfaces"] == []


def test_endpoints_drive_vms_and_explain_external_devices(vm_lab, fake_virsh):
    _path, sid = vm_lab
    client = TestClient(app)
    res = client.post("/api/lab/node-action", json={"sessionId": sid, "node": "r1", "action": "stop"})
    assert res.status_code == 200 and res.json()["code"] == 0
    res = client.post(
        "/api/lab/link-state", json={"sessionId": sid, "node": "r1", "interface": "Ethernet2", "up": False}
    )
    assert res.status_code == 200 and res.json()["code"] == 0
    calls = fake_virsh.read_text()
    assert "shutdown lab_r1" in calls and "domif-setlink lab_r1 52:54:00:00:00:03 down" in calls

    impair = client.post("/api/lab/link-impairment", json={"sessionId": sid, "node": "r1", "interface": "Ethernet2"})
    assert impair.status_code == 409 and "libvirt VM" in impair.json()["detail"]
    ext = client.post("/api/lab/node-action", json={"sessionId": sid, "node": "ext", "action": "stop"})
    assert ext.status_code == 409 and "external device" in ext.json()["detail"]


def test_capture_endpoint_explains_vm_tunnels(vm_lab):
    path, sid = vm_lab
    res = TestClient(app).get(
        "/api/lab/capture/pcap", params={"sessionId": sid, "node": "r1", "interface": "Ethernet1"}
    )
    assert res.status_code == 409 and "UDP tunnels" in res.json()["detail"]
    target = asyncio.run(pcap._capture_target(str(path), "r1", "Ethernet2"))
    assert target == (0, "vnet7")
