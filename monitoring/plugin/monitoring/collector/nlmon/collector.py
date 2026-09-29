"""Collection cycle: walk the plan, collect every node in parallel, publish the text."""

from __future__ import annotations

import concurrent.futures
import json
import os
import threading
import time
from dataclasses import dataclass, field

from . import frr, host, libvirt
from .metrics import Sink, render
from .runtime import ContainerRuntime


@dataclass
class Paths:
    proc: str = "/proc"
    sysfs: str = "/sys"
    docker_socket: str = "/var/run/docker.sock"
    libvirt_run: str = "/run/libvirt"


@dataclass
class Plan:
    lab: str
    interval: float
    workers: int
    nodes: dict[str, dict]
    links: list[dict]
    expected: dict[str, list[dict]]
    resolver: frr.Resolver
    raw: dict = field(repr=False, default_factory=dict)

    @classmethod
    def load(cls, path: str) -> Plan:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        nodes = raw.get("nodes") or {}
        return cls(
            lab=str(raw.get("lab") or ""),
            interval=float(raw.get("interval") or 15),
            workers=int(raw.get("workers") or 2),
            nodes=nodes,
            links=raw.get("links") or [],
            expected=raw.get("expected") or {},
            resolver=frr.Resolver(raw.get("addresses") or {}, raw.get("router_ids") or {}, set(nodes)),
            raw=raw,
        )


def _ifmap(node: dict) -> dict[str, dict]:
    """Device interface name -> netlab interface labels (management interface included)."""
    result: dict[str, dict] = {}
    for intf in node.get("interfaces") or []:
        labels = {
            "ifname": intf.get("ifname"),
            "link": intf.get("link"),
            "peer_node": intf.get("peer_node"),
            "peer_ifname": intf.get("peer_ifname"),
        }
        result[str(intf.get("dev") or intf.get("ifname"))] = {k: v for k, v in labels.items() if v}
    mgmt = node.get("mgmt") or {}
    if mgmt.get("dev"):
        result.setdefault(str(mgmt["dev"]), {"ifname": mgmt["dev"], "link": "mgmt"})
    return result


def _nic_labels(node: dict) -> list[dict | None]:
    """libvirt NIC order: management NIC, then the data interfaces by position."""
    labels: list[dict | None] = [{"ifname": (node.get("mgmt") or {}).get("dev") or "mgmt", "link": "mgmt"}]
    for intf in node.get("interfaces") or []:
        nic = intf.get("nic")
        if not isinstance(nic, int):
            continue
        while len(labels) <= nic:
            labels.append(None)
        labels[nic] = {
            k: v
            for k, v in {
                "ifname": intf.get("ifname"),
                "link": intf.get("link"),
                "peer_node": intf.get("peer_node"),
                "peer_ifname": intf.get("peer_ifname"),
            }.items()
            if v
        }
    return labels


class Collector:
    def __init__(self, plan: Plan, paths: Paths) -> None:
        self.plan = plan
        self.paths = paths
        self.runtime = ContainerRuntime(paths.docker_socket, paths.proc)
        self.cgroups = host.Cgroups(paths.proc, paths.sysfs)
        self._ifmaps = {name: _ifmap(node) for name, node in plan.nodes.items()}
        self._text = "# no data yet\n"
        self._lock = threading.Lock()
        self._static = self._static_sinks()
        self.last_cycle = 0.0

    # ------------------------------------------------------------ static samples
    def _static_sinks(self) -> list[Sink]:
        lab = self.plan.lab
        sink = Sink({"lab": lab})
        for name, node in self.plan.nodes.items():
            sink.add(
                "netlab_node_info",
                1,
                node=name,
                device=node.get("device"),
                provider=node.get("provider"),
                methods=",".join(node.get("methods") or []),
                role=node.get("role"),
            )
        for link in self.plan.links:
            sink.add("netlab_link_info", 1, **{k: v for k, v in link.items() if isinstance(v, (str, int))})
        for item in self.plan.expected.get("bgp", []):
            sink.add("netlab_expected_bgp_session", 1, **item)
        for item in self.plan.expected.get("ospf", []):
            sink.add("netlab_expected_ospf_adjacency", 1, **item)
        for item in self.plan.expected.get("isis", []):
            sink.add("netlab_expected_isis_adjacency", 1, **item)
        sink.add("netlab_collector_nodes", len(self.plan.nodes))
        return [sink]

    # ------------------------------------------------------------ per node
    def collect_node(self, name: str) -> Sink:
        node = self.plan.nodes[name]
        sink = Sink({"lab": self.plan.lab, "node": name})
        methods = node.get("methods") or []
        ifmap = self._ifmaps[name]
        root = None
        if node.get("provider") == "clab" and node.get("container"):
            started = time.perf_counter()
            found = self.runtime.lookup(node["container"])
            sink.add("netlab_node_up", 1 if found else 0)
            if found:
                pid, cid = found
                root = f"{self.paths.proc}/{pid}/root"
                if "host" in methods:
                    ok = host.container_node(sink, pid, cid, self.paths.proc, self.cgroups, ifmap)
                    sink.add("netlab_collector_up", 1 if ok else 0, method="host")
            sink.add("netlab_collector_duration_seconds", round(time.perf_counter() - started, 6), method="host")
        elif node.get("provider") == "libvirt" and node.get("domain"):
            started = time.perf_counter()
            ok = libvirt.vm_node(
                sink,
                self.paths.libvirt_run,
                node["domain"],
                self.paths.proc,
                self.paths.sysfs,
                self.cgroups,
                _nic_labels(node),
            )
            sink.add("netlab_node_up", 1 if ok else 0)
            sink.add("netlab_collector_up", 1 if ok else 0, method="host")
            sink.add("netlab_collector_duration_seconds", round(time.perf_counter() - started, 6), method="host")
        if "frr" in methods:
            started = time.perf_counter()
            cfg = node.get("frr") or {}
            ok = bool(root) and frr.collect(
                sink,
                root,
                cfg.get("protocols") or [],
                cfg.get("socket_dirs") or ["run/frr", "var/run/frr"],
                self.plan.resolver,
                ifmap,
            )
            sink.add("netlab_collector_up", 1 if ok else 0, method="frr")
            sink.add("netlab_collector_duration_seconds", round(time.perf_counter() - started, 6), method="frr")
        return sink

    # ------------------------------------------------------------ cycle
    def cycle(self) -> str:
        started = time.perf_counter()
        sinks: list[Sink] = list(self._static)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, self.plan.workers)) as pool:
            for sink in pool.map(self._safe_collect, list(self.plan.nodes)):
                sinks.append(sink)
        self.last_cycle = time.perf_counter() - started
        meta = Sink({"lab": self.plan.lab})
        meta.add("netlab_collector_cycle_seconds", round(self.last_cycle, 6))
        sinks.append(meta)
        text = render(sinks)
        with self._lock:
            self._text = text
        return text

    def _safe_collect(self, name: str) -> Sink:
        try:
            return self.collect_node(name)
        except Exception as exc:  # noqa: BLE001 -- one broken node must not stop the cycle
            sink = Sink({"lab": self.plan.lab, "node": name})
            sink.add("netlab_collector_up", 0, method="error", error=type(exc).__name__)
            return sink

    @property
    def text(self) -> str:
        with self._lock:
            return self._text

    def run_forever(self, stop: threading.Event) -> None:
        while not stop.is_set():
            started = time.monotonic()
            self.cycle()
            stop.wait(max(1.0, self.plan.interval - (time.monotonic() - started)))


def default_paths() -> Paths:
    """Host paths: /host/... when the host is bind-mounted (node placement), else the real ones."""
    proc = "/host/proc" if os.path.isdir("/host/proc/1") else "/proc"
    sysfs = "/host/sys" if os.path.isdir("/host/sys/class") else "/sys"
    run = "/host/run/libvirt" if os.path.isdir("/host/run/libvirt") else "/run/libvirt"
    return Paths(proc=proc, sysfs=sysfs, libvirt_run=run)
