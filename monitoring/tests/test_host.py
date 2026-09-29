"""Host-side collection against a fake /proc and /sys tree (cgroup v1 and v2, libvirt)."""
# ruff: noqa: E501 -- /proc/net/dev sample lines are wider than the line limit

from nlmon import host, libvirt
from nlmon.metrics import Sink

NETDEV = """Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:     100       1    0    0    0     0          0         0      100       1    0    0    0     0       0          0
  eth0:    2000      20    0    0    0     0          0         0     3000      30    0    0    0     0       0          0
  eth1:    5000      50    1    2    0     0          0         0     6000      60    3    4    0     0       0          0
 vnet7:     700       7    0    0    0     0          0         0      800       8    0    0    0     0       0          0
"""


def values(sink, name):
    return {labels.get("ifname", labels.get("node", "")): v for n, labels, v in sink.samples if n == name}


def make_proc(tmp_path, pid=4242, cgroup="0::/system.slice/docker-abc.scope\n"):
    proc = tmp_path / "proc"
    (proc / str(pid) / "net").mkdir(parents=True)
    (proc / str(pid) / "net" / "dev").write_text(NETDEV)
    (proc / str(pid) / "cgroup").write_text(cgroup)
    for dev, state, changes in (("eth0", "up", "2"), ("eth1", "down", "7")):
        d = proc / str(pid) / "root" / "sys" / "class" / "net" / dev
        d.mkdir(parents=True)
        (d / "operstate").write_text(state + "\n")
        (d / "carrier_changes").write_text(changes + "\n")
    return proc


def test_container_node_cgroup_v2(tmp_path):
    proc = make_proc(tmp_path)
    cg = tmp_path / "sys" / "fs" / "cgroup"
    (cg / "system.slice" / "docker-abc.scope").mkdir(parents=True)
    (cg / "cgroup.controllers").write_text("cpu memory\n")
    (cg / "system.slice" / "docker-abc.scope" / "cpu.stat").write_text("usage_usec 2500000\nuser_usec 1\n")
    (cg / "system.slice" / "docker-abc.scope" / "memory.current").write_text("10000000\n")
    (cg / "system.slice" / "docker-abc.scope" / "memory.stat").write_text("inactive_file 4000000\n")
    cgroups = host.Cgroups(str(proc), str(tmp_path / "sys"))
    sink = Sink({"node": "r1"})
    ifmap = {"eth1": {"ifname": "Ethernet1", "link": "r1-r2", "peer_node": "r2"}, "eth0": {"ifname": "mgmt0"}}
    assert host.container_node(sink, 4242, "abc", str(proc), cgroups, ifmap)
    assert values(sink, "netlab_node_cpu_seconds_total") == {"r1": 2.5}
    assert values(sink, "netlab_node_memory_bytes") == {"r1": 6000000}
    assert values(sink, "netlab_if_rx_bytes_total") == {"Ethernet1": 5000, "mgmt0": 2000}
    assert values(sink, "netlab_if_tx_drops_total")["Ethernet1"] == 4
    assert values(sink, "netlab_if_oper_up") == {"Ethernet1": 0, "mgmt0": 1}
    assert values(sink, "netlab_if_carrier_changes_total")["Ethernet1"] == 7
    assert "lo" not in values(sink, "netlab_if_rx_bytes_total")


def test_cgroup_v1_found_through_container_id(tmp_path):
    proc = make_proc(tmp_path, cgroup="12:memory:/\n11:cpu,cpuacct:/\n")  # private cgroup namespace view
    cg = tmp_path / "sys" / "fs" / "cgroup"
    (cg / "cpu,cpuacct" / "docker" / "abc").mkdir(parents=True)
    (cg / "memory" / "docker" / "abc").mkdir(parents=True)
    (cg / "cpu,cpuacct" / "docker" / "abc" / "cpuacct.usage").write_text("3000000000\n")
    (cg / "memory" / "docker" / "abc" / "memory.usage_in_bytes").write_text("5000\n")
    (cg / "memory" / "docker" / "abc" / "memory.stat").write_text("total_inactive_file 1000\n")
    cgroups = host.Cgroups(str(proc), str(tmp_path / "sys"))
    assert cgroups.cpu_seconds(4242, "abc") == 3.0
    assert cgroups.memory_bytes(4242, "abc") == 4000


def test_libvirt_vm_taps_by_nic_order(tmp_path):
    run = tmp_path / "run" / "libvirt" / "qemu"
    run.mkdir(parents=True)
    (run / "lab_r9.xml").write_text("""<domstatus state='running' pid='4242'><domain type='kvm'><name>lab_r9</name>
<devices>
 <interface type='network'><target dev='vnet6'/></interface>
 <interface type='udp'><source address='127.1.1.1' port='10001'/></interface>
 <interface type='bridge'><target dev='vnet7'/></interface>
</devices></domain></domstatus>""")
    proc = make_proc(tmp_path)
    (proc / "1" / "net").mkdir(parents=True)
    (proc / "1" / "net" / "dev").write_text(NETDEV)
    sysfs = tmp_path / "sys"
    (sysfs / "class" / "net" / "vnet7").mkdir(parents=True)
    (sysfs / "class" / "net" / "vnet7" / "operstate").write_text("up\n")
    sink = Sink({"node": "r9"})
    labels = [
        {"ifname": "mgmt", "link": "mgmt"},
        {"ifname": "ge-0/0/0", "link": "r9-r1"},
        {"ifname": "ge-0/0/1", "link": "lan1"},
    ]
    assert libvirt.vm_node(
        sink,
        str(tmp_path / "run" / "libvirt"),
        "lab_r9",
        str(proc),
        str(sysfs),
        host.Cgroups(str(proc), str(sysfs)),
        labels,
    )
    # tap counters are the host's view: host rx = VM tx
    assert values(sink, "netlab_if_tx_bytes_total") == {"ge-0/0/1": 700}
    assert values(sink, "netlab_if_rx_bytes_total") == {"ge-0/0/1": 800}
    assert "ge-0/0/0" not in values(sink, "netlab_if_rx_bytes_total")  # UDP tunnel: no tap
    assert (
        libvirt.vm_node(
            Sink(),
            str(tmp_path / "run" / "libvirt"),
            "missing",
            str(proc),
            str(sysfs),
            host.Cgroups(str(proc), str(sysfs)),
            labels,
        )
        is False
    )
