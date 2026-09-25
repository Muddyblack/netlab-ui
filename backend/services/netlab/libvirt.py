"""Runtime access to netlab's libvirt VMs — state, interfaces, counters, actions.

Everything here follows netlab's own libvirt provider
(``netsim/providers/libvirt``) so the UI sees the lab the way netlab does:

* A node's libvirt domain is ``<lab name>_<node>`` (``get_node_name``).
* The Vagrantfile gives every VM its management NIC first, then one NIC per
  node interface that is not a virtual one, in order (``define-domain.j2``).
  ``virsh domiflist`` lists them in that order, which maps each row to the
  netlab interface name (``Ethernet1``, ``GigabitEthernet0/1``…).
* Point-to-point links are UDP tunnels without a host interface; only
  multi-access links attach to a libvirt network (a Linux bridge) through a
  host ``vnetN`` tap (``get_linux_intf``). Host-side counters and capture
  therefore exist for LAN links only; link up/down works on every NIC because
  ``virsh domif-setlink`` addresses it by MAC.

``virsh`` is run exactly as netlab runs it (no ``-c``), so
``LIBVIRT_DEFAULT_URI`` and group membership apply the same way.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services.netlab import runner

SYSFS_NET = Path("/sys/class/net")

# UI node action → virsh subcommand. `shutdown` asks the guest OS to power
# off cleanly, like pressing the power button; `reboot` likewise.
NODE_ACTIONS = {
    "start": "start",
    "stop": "shutdown",
    "restart": "reboot",
    "pause": "suspend",
    "unpause": "resume",
}


@dataclass(frozen=True)
class VmInterface:
    ifname: str  # netlab's name inside the VM
    target: str | None  # host tap (vnetN) — None for UDP tunnels
    mac: str
    bridge: str | None  # libvirt network for LAN links


def domain_name(lab_name: str, node: str) -> str:
    """netlab's libvirt domain name for a node (providers/libvirt get_node_name)."""
    return f"{lab_name.split('.')[0]}_{node}"


def parse_domiflist(text: str) -> list[dict[str, str]]:
    """Rows of ``virsh domiflist``: Interface, Type, Source, Model, MAC."""
    rows = []
    for line in text.splitlines():
        fields = line.split()
        # The header row is skipped by name, the dashed rule by field count;
        # a lone "-" is a real row (a UDP tunnel has no host interface).
        if len(fields) != 5 or fields[0] == "Interface":
            continue
        rows.append(dict(zip(("target", "type", "source", "model", "mac"), fields, strict=True)))
    return rows


def data_interfaces(node: dict[str, Any]) -> list[dict[str, Any]]:
    """The node's interfaces that get a VM NIC, in Vagrantfile order."""
    return [
        iface
        for iface in node.get("interfaces") or []
        if isinstance(iface, dict) and not iface.get("virtual_interface") and iface.get("type") != "loopback"
    ]


def map_interfaces(rows: list[dict[str, str]], node: dict[str, Any]) -> list[VmInterface]:
    """Pair domiflist rows (management NIC first) with netlab's interfaces."""
    result = []
    for row, iface in zip(rows[1:], data_interfaces(node), strict=False):
        target = row["target"] if row["target"] not in {"-", ""} else None
        bridge = str(iface.get("bridge")) if iface.get("bridge") else None
        result.append(VmInterface(str(iface.get("ifname") or ""), target, row["mac"], bridge))
    return result


async def virsh(*args: str) -> runner.CommandResult:
    return await runner._run_external("virsh", list(args))


async def interfaces(domain: str, node: dict[str, Any]) -> list[VmInterface]:
    result = await virsh("domiflist", domain)
    if result.code != 0:
        return []
    return map_interfaces(parse_domiflist(result.stdout), node)


def _read(path: Path) -> str:
    try:
        return path.read_text().strip()
    except OSError:
        return ""


def _counter(target: str, name: str) -> int:
    value = _read(SYSFS_NET / target / "statistics" / name)
    return int(value) if value.isdigit() else 0


def host_counters(target: str) -> dict[str, Any]:
    """The tap's counters seen from inside the VM, in ``ip -j -s link`` shape.

    A tap is the host end of the VM's NIC: what the host *receives* on it is
    what the VM *sent*. Swapping rx/tx here makes the numbers read like any
    container interface's."""
    sent_by_vm = {key: _counter(target, f"rx_{key}") for key in ("bytes", "packets", "errors", "dropped")}
    received_by_vm = {key: _counter(target, f"tx_{key}") for key in ("bytes", "packets", "errors", "dropped")}
    return {"stats64": {"rx": received_by_vm, "tx": sent_by_vm}, "operstate": _read(SYSFS_NET / target / "operstate")}


async def link_state(domain: str, mac: str) -> str:
    """``up``/``down`` as set with domif-setlink (unknown if virsh can't say)."""
    result = await virsh("domif-getlink", domain, mac)
    text = result.stdout.lower()
    if result.code != 0:
        return "unknown"
    return "down" if " down" in text else "up" if " up" in text else "unknown"


async def runtime_interfaces(domain: str, node: dict[str, Any]) -> list[dict[str, Any]]:
    """Interfaces of a running VM in the ``ip -j -s link`` shape
    :mod:`services.netlab.runtime` expects; counters only for LAN links."""
    vm_ifaces = await interfaces(domain, node)
    states = await asyncio.gather(*(link_state(domain, iface.mac) for iface in vm_ifaces))
    raw = []
    for iface, state in zip(vm_ifaces, states, strict=True):
        entry: dict[str, Any] = {"ifname": iface.ifname, "address": iface.mac, "operstate": state, "link_type": "ether"}
        if iface.target:
            counters = host_counters(iface.target)
            entry["stats64"] = counters["stats64"]
            if state == "unknown":
                entry["operstate"] = counters["operstate"] or "unknown"
        raw.append(entry)
    return raw


async def node_action(domain: str, action: str) -> runner.CommandResult:
    if action not in NODE_ACTIONS:
        return runner.CommandResult(2, "", f"Unsupported action {action!r} for a libvirt VM")
    result = await virsh(NODE_ACTIONS[action], domain)
    runner._clear_status_cache()
    return result


async def set_link(domain: str, node: dict[str, Any], ifname: str, up: bool) -> runner.CommandResult:
    """Cable pull / reconnect on one VM NIC (works for tunnels too)."""
    match = next((iface for iface in await interfaces(domain, node) if iface.ifname == ifname), None)
    if match is None:
        return runner.CommandResult(1, "", f"{domain} has no interface {ifname} (is the VM running?)")
    return await virsh("domif-setlink", domain, match.mac, "up" if up else "down")


async def lan_tap(domain: str, node: dict[str, Any], ifname: str, purpose: str, instead: str) -> str:
    """The host tap of a VM interface; ValueError explains why there is none."""
    match = next((iface for iface in await interfaces(domain, node) if iface.ifname == ifname), None)
    if match is None:
        raise ValueError(f"{domain} has no interface {ifname} (is the VM running?)")
    if match.target is None:
        raise ValueError(
            f"{ifname} is a point-to-point link — netlab builds those as UDP tunnels with no host "
            f"interface for {purpose}. {instead}"
        )
    return match.target


async def capture_interface(domain: str, node: dict[str, Any], ifname: str) -> str:
    """The host tap to capture a VM interface on; ValueError explains why not."""
    return await lan_tap(domain, node, ifname, "capture", "Capture on a LAN link, or inside the VM.")


_NETLAB_ERROR_RE = re.compile(r"(?m)^\s*(\[ERROR\]|\w*Error\b)")
_NUMBER_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)\s*$")
_TIME_MS = {"": 1.0, "ms": 1.0, "s": 1000.0, "us": 0.001}
_RATE_KBPS = {"": 1.0, "k": 1.0, "kbit": 1.0, "kbps": 1.0, "m": 1000.0, "mbit": 1000.0, "mbps": 1000.0}
_RATE_KBPS |= {"g": 1e6, "gbit": 1e6, "gbps": 1e6}


def _tc_value(value: str, units: dict[str, float], what: str) -> str:
    """A UI value ("10", "10ms", "1.5s", "5%", "10mbit") in netlab tc's unit."""
    match = _NUMBER_RE.match(value)
    unit = match.group(2).lower() if match else ""
    if not match or unit not in units:
        raise ValueError(f"can't read {value!r} as a {what}")
    return f"{float(match.group(1)) * units[unit]:g}"


def tc_args(node: str, ifname: str, **fields: str) -> list[str]:
    """``netlab tc`` arguments for the UI's impairment fields; all empty clears."""
    percent = {"": 1.0, "%": 1.0}
    spec = {
        "delay": (_TIME_MS, "time"),
        "jitter": (_TIME_MS, "time"),
        "loss": (percent, "percentage"),
        "corruption": (percent, "percentage"),
        "rate": (_RATE_KBPS, "rate"),
    }
    flags = {"corruption": "--corrupt"}
    args: list[str] = []
    for name, (units, what) in spec.items():
        value = (fields.get(name) or "").strip()
        if value:
            args += [flags.get(name, f"--{name}"), _tc_value(value, units, what)]
    if not args:
        return ["tc", "disable", "-n", node, "-i", ifname]
    return ["tc", "set", "-n", node, "-i", ifname, *args]


async def set_impairment(
    topology_path: str | Path, domain: str, name: str, node: dict[str, Any], ifname: str, **fields: str
) -> runner.CommandResult:
    """Link impairment on a VM interface through ``netlab tc`` — which, like
    capture, needs the host tap of a LAN link."""
    try:
        await lan_tap(domain, node, ifname, "traffic control", "Impair a LAN link instead.")
        args = tc_args(name, ifname, **fields)
    except ValueError as exc:
        return runner.CommandResult(1, "", str(exc))
    result = await runner.run_command(args, cwd=Path(topology_path).parent)
    # netlab reports a failed tc as an error line but may still exit 0.
    failed = result.code or _NETLAB_ERROR_RE.search(result.stdout + result.stderr)
    return runner.CommandResult(1 if failed else 0, result.stdout, result.stderr)
