"""Host-side node metrics: cgroup CPU/memory and interface counters.

Everything is read from the host's /proc and /sys, so it works for any container
image (no tools needed inside the node) and for nodes without a management network.
"""

from __future__ import annotations

import os

from .metrics import Sink

NETDEV_FIELDS = (
    # (column in /proc/net/dev, metric, is_rx)
    (0, "netlab_if_rx_bytes_total"),
    (1, "netlab_if_rx_packets_total"),
    (2, "netlab_if_rx_errors_total"),
    (3, "netlab_if_rx_drops_total"),
    (8, "netlab_if_tx_bytes_total"),
    (9, "netlab_if_tx_packets_total"),
    (10, "netlab_if_tx_errors_total"),
    (11, "netlab_if_tx_drops_total"),
)


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="ascii", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def parse_netdev(text: str) -> dict[str, list[int]]:
    """/proc/<pid>/net/dev -> {ifname: [16 counters]}."""
    result: dict[str, list[int]] = {}
    for line in text.splitlines()[2:]:
        name, sep, rest = line.partition(":")
        if not sep:
            continue
        try:
            result[name.strip()] = [int(v) for v in rest.split()]
        except ValueError:
            continue
    return result


def _kv(text: str | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].isdigit():
            out[parts[0]] = int(parts[1])
    return out


class Cgroups:
    """Locate a process's cgroup and read CPU/memory for v1 and v2 hierarchies."""

    def __init__(self, proc: str = "/proc", sysfs: str = "/sys") -> None:
        self.proc = proc
        self.root = f"{sysfs}/fs/cgroup"
        self.v2 = os.path.exists(f"{self.root}/cgroup.controllers")

    def _candidates(self, pid: int, cid: str, controller: str) -> list[str]:
        """Possible cgroup directories: the path in /proc/<pid>/cgroup (correct when we
        share the host cgroup namespace), then the usual docker/podman/libvirt layouts."""
        paths: list[str] = []
        for line in (_read(f"{self.proc}/{pid}/cgroup") or "").splitlines():
            hid, ctrls, path = [*line.split(":", 2), "", ""][:3]
            if (self.v2 and hid == "0") or (not self.v2 and controller in ctrls.split(",")):
                paths.append(path)
        if cid:
            paths += [f"/docker/{cid}", f"/system.slice/docker-{cid}.scope", f"/machine.slice/libpod-{cid}.scope"]
        base = self.root if self.v2 else f"{self.root}/{'cpu,cpuacct' if controller == 'cpuacct' else controller}"
        if not self.v2 and not os.path.isdir(base):
            base = f"{self.root}/{controller}"
        return [f"{base}{p}" for p in paths if "/.." not in p]

    def _find(self, pid: int, cid: str, controller: str, filename: str) -> str | None:
        for path in self._candidates(pid, cid, controller):
            if os.path.exists(f"{path}/{filename}"):
                return path
        return None

    def cpu_seconds(self, pid: int, cid: str = "") -> float | None:
        if self.v2:
            path = self._find(pid, cid, "", "cpu.stat")
            usec = _kv(_read(f"{path}/cpu.stat")).get("usage_usec") if path else None
            return usec / 1e6 if usec is not None else None
        path = self._find(pid, cid, "cpuacct", "cpuacct.usage")
        text = _read(f"{path}/cpuacct.usage") if path else None
        return int(text) / 1e9 if text and text.strip().isdigit() else None

    def memory_bytes(self, pid: int, cid: str = "") -> float | None:
        """Working set (usage minus inactive file cache), like `docker stats`."""
        if self.v2:
            path = self._find(pid, cid, "", "memory.current")
            if not path:
                return None
            usage = (_read(f"{path}/memory.current") or "").strip()
            inactive = _kv(_read(f"{path}/memory.stat")).get("inactive_file", 0)
        else:
            path = self._find(pid, cid, "memory", "memory.usage_in_bytes")
            if not path:
                return None
            usage = (_read(f"{path}/memory.usage_in_bytes") or "").strip()
            inactive = _kv(_read(f"{path}/memory.stat")).get("total_inactive_file", 0)
        return max(int(usage) - inactive, 0) if usage.isdigit() else None


def interface_samples(
    sink: Sink,
    counters: dict[str, list[int]],
    state_dir: str | None,
    interfaces: dict[str, dict],
    include_unknown: bool = False,
    swap_rx_tx: bool = False,
) -> None:
    """Emit interface counters for the devices in ``interfaces`` (device name -> labels).

    ``state_dir`` is a sysfs 'class/net' directory for operstate/carrier_changes.
    ``swap_rx_tx`` is for host-side taps (the host's rx is the VM's tx)."""
    for dev, values in counters.items():
        labels = interfaces.get(dev)
        if labels is None:
            if not include_unknown or dev == "lo":
                continue
            labels = {"ifname": dev}
        for column, metric in NETDEV_FIELDS:
            if column >= len(values):
                continue
            name = metric
            if swap_rx_tx:
                name = metric.replace("_rx_", "_xx_").replace("_tx_", "_rx_").replace("_xx_", "_tx_")
            sink.add(name, values[column], **labels)
        if state_dir:
            oper = _read(f"{state_dir}/{dev}/operstate")
            if oper is not None:
                sink.add("netlab_if_oper_up", 1 if oper.strip() in ("up", "unknown") else 0, **labels)
            changes = _read(f"{state_dir}/{dev}/carrier_changes")
            if changes and changes.strip().isdigit():
                sink.add("netlab_if_carrier_changes_total", int(changes), **labels)


def container_node(
    sink: Sink,
    pid: int,
    cid: str,
    proc: str,
    cgroups: Cgroups,
    interfaces: dict[str, dict],
) -> bool:
    """CPU, memory and interface metrics for one running container."""
    sink.add("netlab_node_cpu_seconds_total", cgroups.cpu_seconds(pid, cid))
    sink.add("netlab_node_memory_bytes", cgroups.memory_bytes(pid, cid))
    text = _read(f"{proc}/{pid}/net/dev")
    if text is None:
        return False
    # The node's own sysfs (mounted in its mount namespace) shows its interfaces.
    state_dir = f"{proc}/{pid}/root/sys/class/net"
    interface_samples(sink, parse_netdev(text), state_dir, interfaces)
    return True
