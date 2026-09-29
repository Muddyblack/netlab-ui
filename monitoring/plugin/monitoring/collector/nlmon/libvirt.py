"""libvirt VMs: CPU, memory and tap counters without virsh.

libvirt keeps the live domain definition in /run/libvirt/qemu/<domain>.xml
(a <domstatus pid='...'> wrapper around <domain>). NICs appear in the same order
netlab created them: the management NIC first, then one NIC per data interface.
p2p links built as UDP tunnels have no host tap, so they have no host-side counters.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from .host import Cgroups, interface_samples, parse_netdev
from .metrics import Sink


def domain_state(run_dir: str, domain: str) -> tuple[int, list[str | None]] | None:
    """(qemu pid, [tap device per NIC in order, None when the NIC has no tap])."""
    try:
        root = ET.parse(f"{run_dir}/qemu/{domain}.xml").getroot()
    except (OSError, ET.ParseError):
        return None
    pid = int(root.get("pid") or 0)
    dom = root.find("domain") if root.tag == "domstatus" else root
    if dom is None:
        return None
    taps: list[str | None] = []
    for intf in dom.findall("./devices/interface"):
        target = intf.find("target")
        taps.append(target.get("dev") if target is not None and intf.get("type") != "udp" else None)
    return pid, taps


def vm_node(
    sink: Sink,
    run_dir: str,
    domain: str,
    proc: str,
    sysfs: str,
    cgroups: Cgroups,
    nic_labels: list[dict | None],
) -> bool:
    """``nic_labels``: interface labels per NIC position (index 0 = management NIC)."""
    state = domain_state(run_dir, domain)
    if state is None:
        return False
    pid, taps = state
    if pid:
        sink.add("netlab_node_cpu_seconds_total", cgroups.cpu_seconds(pid))
        sink.add("netlab_node_memory_bytes", cgroups.memory_bytes(pid))
    netdev = parse_netdev(_read_netdev(proc))
    interfaces: dict[str, dict] = {}
    for position, tap in enumerate(taps):
        if tap and position < len(nic_labels) and nic_labels[position] is not None:
            interfaces[tap] = nic_labels[position]
    counters = {tap: netdev[tap] for tap in interfaces if tap in netdev}
    interface_samples(sink, counters, f"{sysfs}/class/net", interfaces, swap_rx_tx=True)
    return True


def _read_netdev(proc: str) -> str:
    # Host network namespace counters (the collector may run in its own netns, so use PID 1's view).
    for path in (f"{proc}/1/net/dev", f"{proc}/net/dev"):
        try:
            with open(path, encoding="ascii") as handle:
                return handle.read()
        except OSError:
            continue
    return ""
