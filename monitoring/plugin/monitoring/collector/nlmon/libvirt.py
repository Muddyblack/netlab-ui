"""libvirt VMs: CPU, memory and tap counters without virsh.

libvirt keeps the live domain definition in /run/libvirt/qemu/<domain>.xml
(a <domstatus pid='...'> wrapper around <domain>). NICs appear in the same order
netlab created them: the management NIC first, then one NIC per data interface.
p2p links built as UDP tunnels have no host tap, so they have no host-side counters (their
link state still comes from libvirt).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from .host import Cgroups, interface_samples, parse_netdev
from .metrics import Sink


def cgroup_hints(domain: str, dom_id: str) -> tuple[str, ...]:
    """Where libvirt/systemd put the VM's cgroup, for when /proc/<pid>/cgroup can't be followed
    (a collector in its own cgroup namespace sees '/../..' paths)."""
    escaped = domain.replace("-", "\\x2d")
    return (f"/machine.slice/machine-qemu\\x2d{dom_id}\\x2d{escaped}.scope", f"/machine/{domain}.libvirt-qemu")


def domain_state(run_dir: str, domain: str) -> tuple[int, list[str | None], str, list[bool]] | None:
    """(qemu pid, [tap device per NIC in order, None when the NIC has no tap], libvirt domain id,
    [link up per NIC]). The link state is what the guest sees: `virsh domif-setlink` (cable
    pull) records it as <link state='down'/> and leaves the host tap alone."""
    try:
        root = ET.parse(f"{run_dir}/qemu/{domain}.xml").getroot()
    except (OSError, ET.ParseError):
        return None
    pid = int(root.get("pid") or 0)
    dom = root.find("domain") if root.tag == "domstatus" else root
    if dom is None:
        return None
    taps: list[str | None] = []
    links: list[bool] = []
    for intf in dom.findall("./devices/interface"):
        target = intf.find("target")
        taps.append(target.get("dev") if target is not None and intf.get("type") != "udp" else None)
        link = intf.find("link")
        links.append(link is None or link.get("state") != "down")
    return pid, taps, dom.get("id") or root.get("id") or "", links


def vm_node(
    sink: Sink,
    run_dir: str,
    domain: str,
    proc: str,
    cgroups: Cgroups,
    nic_labels: list[dict | None],
) -> bool:
    """``nic_labels``: interface labels per NIC position (index 0 = management NIC)."""
    state = domain_state(run_dir, domain)
    if state is None:
        return False
    pid, taps, dom_id, links = state
    if pid:
        hints = cgroup_hints(domain, dom_id)
        sink.add("netlab_node_cpu_seconds_total", cgroups.cpu_seconds(pid, extra=hints))
        sink.add("netlab_node_memory_bytes", cgroups.memory_bytes(pid, extra=hints))
    netdev = parse_netdev(_read_netdev(proc))
    interfaces: dict[str, dict] = {}
    for position, tap in enumerate(taps):
        if tap and position < len(nic_labels) and nic_labels[position] is not None:
            interfaces[tap] = nic_labels[position]
    counters = {tap: netdev[tap] for tap in interfaces if tap in netdev}
    # counters come from the host tap (LAN links only); the link state from libvirt, for every NIC
    interface_samples(sink, counters, None, interfaces, swap_rx_tx=True)
    for position, labels in enumerate(nic_labels):
        if labels is not None and position < len(links):
            sink.add("netlab_if_oper_up", 1 if links[position] else 0, **labels)
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
