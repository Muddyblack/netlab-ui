"""Repeatable fault scenarios: take links down and up on a schedule and measure convergence.

A scenario flaps one or more lab links for N cycles (down for X s, up for Y s). Each cycle
is marked on the lab's Grafana dashboards and measured against what the netlab topology
expects (the monitoring plugin's ``netlab_expected_*`` metrics):

* reaction: how long until the lab noticed (a session/adjacency the topology defines went down),
* impact: how many sessions/adjacencies were down at the worst moment,
* recovery: how long after the link came back until everything was up again -- exact when the
  devices report when a session came up (FRR does), otherwise at sampling resolution.

The collector is sampled directly (not the metrics store) about twice a second, so a
scenario sees changes much faster than the dashboards' scrape interval. Results are kept in
``<lab>/monitoring/scenarios/`` so runs can be compared later.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import secrets
import time
import urllib.error
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from services import monitoring
from services.netlab import libvirt, runner

SAMPLE_INTERVAL = 0.5
_LINE = re.compile(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)$")
_LABEL = re.compile(r'(\w+)="((?:[^"\\]|\\.)*)"')

# (expected metric, observed metric, key labels, last-change metric)
_CHECKS = (
    (
        "netlab_expected_bgp_session",
        "netlab_bgp_session_up",
        ("node", "peer", "vrf"),
        "netlab_bgp_session_last_change_timestamp_seconds",
    ),
    (
        "netlab_expected_ospf_adjacency",
        "netlab_ospf_neighbor_up",
        ("node", "peer_node", "ifname"),
        "netlab_ospf_neighbor_last_change_timestamp_seconds",
    ),
    (
        "netlab_expected_isis_adjacency",
        "netlab_isis_adjacency_up",
        ("node", "peer_node", "ifname"),
        "netlab_isis_adjacency_last_change_timestamp_seconds",
    ),
)
_PROTOCOL = {
    "netlab_expected_bgp_session": "BGP",
    "netlab_expected_ospf_adjacency": "OSPF",
    "netlab_expected_isis_adjacency": "IS-IS",
}


def parse_metrics(text: str) -> list[tuple[str, dict[str, str], float]]:
    samples = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        match = _LINE.match(line)
        if not match:
            continue
        labels = {k: v.replace('\\"', '"').replace("\\\\", "\\") for k, v in _LABEL.findall(match.group(2) or "")}
        try:
            samples.append((match.group(1), labels, float(match.group(3))))
        except ValueError:
            continue
    return samples


def missing(samples: list[tuple[str, dict[str, str], float]]) -> set[tuple[str, ...]]:
    """Sessions/adjacencies the topology expects that are not up right now."""
    by_name: dict[str, list[tuple[dict[str, str], float]]] = {}
    for name, labels, value in samples:
        by_name.setdefault(name, []).append((labels, value))
    result: set[tuple[str, ...]] = set()
    for expected, observed, keys, _ in _CHECKS:
        up = {tuple(lbl.get(k, "") for k in keys) for lbl, value in by_name.get(observed, []) if value == 1}
        for labels, _value in by_name.get(expected, []):
            key = tuple(labels.get(k, "") for k in keys)
            if key not in up:
                result.add((_PROTOCOL[expected], *key))
    return result


def last_changes(samples: list[tuple[str, dict[str, str], float]]) -> dict[tuple[str, ...], float]:
    """(protocol, *key) -> time the session/adjacency last changed, where the device says."""
    metric = {change: (_PROTOCOL[expected], keys) for expected, _, keys, change in _CHECKS}
    result: dict[tuple[str, ...], float] = {}
    for name, labels, value in samples:
        if name in metric:
            proto, keys = metric[name]
            result[(proto, *(labels.get(k, "") for k in keys))] = value
    return result


@dataclass
class LinkEnd:
    node: str
    ifname: str


@dataclass
class Cycle:
    cycle: int
    downAt: float
    upAt: float = 0.0
    reactionSeconds: float | None = None
    impact: int = 0
    recoverySeconds: float | None = None
    recoveryExact: bool = False
    affected: list[str] = field(default_factory=list)


@dataclass
class Scenario:
    id: str
    lab: str
    links: list[LinkEnd]
    cycles: int
    downSeconds: float
    upSeconds: float
    settleSeconds: float
    status: str = "running"
    message: str = ""
    startedAt: float = field(default_factory=time.time)
    finishedAt: float | None = None
    baselineMissing: int = 0
    results: list[Cycle] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        def stats(values: list[float]) -> dict[str, float] | None:
            if not values:
                return None
            return {
                "min": round(min(values), 3),
                "avg": round(sum(values) / len(values), 3),
                "max": round(max(values), 3),
            }

        return {
            "reaction": stats([c.reactionSeconds for c in self.results if c.reactionSeconds is not None]),
            "recovery": stats([c.recoverySeconds for c in self.results if c.recoverySeconds is not None]),
            "notRecovered": sum(1 for c in self.results if c.recoverySeconds is None),
        }

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["summary"] = self.summary()
        return data


_jobs: dict[str, Scenario] = {}
_tasks: dict[str, asyncio.Task] = {}


async def _sample(collector_url: str) -> list[tuple[str, dict[str, str], float]]:
    url = f"{collector_url}/metrics?max_age={SAMPLE_INTERVAL}"

    def fetch() -> str:
        with monitoring._DIRECT.open(url, timeout=10) as response:
            return response.read().decode(errors="replace")

    return parse_metrics(await asyncio.to_thread(fetch))


async def _set_link(plan: dict[str, Any], end: LinkEnd, up: bool) -> None:
    node = (plan.get("nodes") or {}).get(end.node)
    if not isinstance(node, dict):
        raise RuntimeError(f"{end.node} is not monitored in this lab")
    interfaces = node.get("interfaces") or []
    intf = next((i for i in interfaces if i.get("ifname") == end.ifname), None)
    if intf is None:
        raise RuntimeError(f"{end.node} has no interface {end.ifname}")
    if node.get("provider") == "clab" and node.get("container"):
        result = await runner.set_interface_state(str(node["container"]), str(intf.get("dev") or end.ifname), up)
    elif node.get("provider") == "libvirt" and node.get("domain"):
        result = await libvirt.set_link(str(node["domain"]), {"interfaces": interfaces}, end.ifname, up)
    else:
        raise RuntimeError(f"{end.node} runs under {node.get('provider')}: links can't be taken down from here")
    if result.code:
        raise RuntimeError(f"{end.node} {end.ifname}: {(result.stderr or result.stdout).strip()}")


async def _all_links(plan: dict[str, Any], links: list[LinkEnd], up: bool) -> None:
    await asyncio.gather(*(_set_link(plan, end, up) for end in links))


def _label(links: list[LinkEnd]) -> str:
    return ", ".join(f"{end.node} {end.ifname}" for end in links)


async def _run(job: Scenario, lab_dir: Path) -> None:
    info = monitoring.stack(lab_dir)
    collector = str(info.get("collector_url") or "")
    plan = json.loads((lab_dir / "monitoring" / "plan.json").read_text())
    what = _label(job.links)
    try:
        baseline = missing(await _sample(collector))
        job.baselineMissing = len(baseline)
        for number in range(1, job.cycles + 1):
            job.message = f"cycle {number}/{job.cycles}: {what} down"
            cycle = Cycle(cycle=number, downAt=time.time())
            job.results.append(cycle)
            await _all_links(plan, job.links, up=False)
            outage = await monitoring.annotate(
                lab_dir, f"Fault test {job.id}: {what} down (cycle {number})", ["scenario"]
            )
            seen: set[tuple[str, ...]] = set()
            while time.time() - cycle.downAt < job.downSeconds:
                now_missing = missing(await _sample(collector)) - baseline
                seen |= now_missing
                cycle.impact = max(cycle.impact, len(now_missing))
                if now_missing and cycle.reactionSeconds is None:
                    cycle.reactionSeconds = round(time.time() - cycle.downAt, 3)
                await asyncio.sleep(SAMPLE_INTERVAL)
            cycle.affected = sorted(" ".join(item) for item in seen)
            job.message = f"cycle {number}/{job.cycles}: {what} up, waiting for recovery"
            cycle.upAt = time.time()
            await _all_links(plan, job.links, up=True)
            if outage is not None:
                text = f"Fault test {job.id}: {what} down (cycle {number}/{job.cycles})"
                await monitoring.annotate_end(lab_dir, outage, text)
            while time.time() - cycle.upAt < job.settleSeconds:
                samples = await _sample(collector)
                if not (missing(samples) - baseline):
                    cycle.recoverySeconds = round(time.time() - cycle.upAt, 3)
                    changes = last_changes(samples)
                    stamps = [changes[item] for item in seen if item in changes]
                    if seen and len(stamps) == len(seen) and max(stamps) >= cycle.upAt - 1:
                        cycle.recoverySeconds = round(max(0.0, max(stamps) - cycle.upAt), 3)
                        cycle.recoveryExact = True
                    break
                await asyncio.sleep(SAMPLE_INTERVAL)
            rest = job.upSeconds - (time.time() - cycle.upAt)
            if number < job.cycles and rest > 0:
                job.message = f"cycle {number}/{job.cycles} done, next in {rest:.0f}s"
                await asyncio.sleep(rest)
        job.status = "done"
        job.message = f"{job.cycles} cycles done"
    except asyncio.CancelledError:
        job.status = "cancelled"
        job.message = "cancelled -- links restored"
        with contextlib.suppress(Exception):
            await _all_links(plan, job.links, up=True)
    except (RuntimeError, OSError, ValueError, urllib.error.URLError) as exc:
        job.status = "failed"
        job.message = str(exc)
        with contextlib.suppress(Exception):
            await _all_links(plan, job.links, up=True)
    finally:
        job.finishedAt = time.time()
        _save(job, lab_dir)
        _tasks.pop(job.id, None)


def _dir(lab_dir: Path) -> Path:
    return lab_dir / "monitoring" / "scenarios"


def _save(job: Scenario, lab_dir: Path) -> None:
    with contextlib.suppress(OSError):
        _dir(lab_dir).mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(job.startedAt))
        (_dir(lab_dir) / f"{stamp}-{job.id}.json").write_text(json.dumps(job.as_dict(), indent=1))


def start(
    lab_dir: Path, links: list[dict[str, str]], cycles: int, down: float, up: float, settle: float
) -> dict[str, Any]:
    info = monitoring.stack(lab_dir)
    if not str(info.get("collector_url") or "").startswith("http"):
        raise RuntimeError("Monitoring is not running for this lab -- turn it on and deploy the lab first")
    if any(job.status == "running" and job.lab == info.get("lab") for job in _jobs.values()):
        raise RuntimeError("A scenario is already running in this lab")
    if not links:
        raise ValueError("Pick at least one link end to take down")
    job = Scenario(
        id=secrets.token_hex(3),
        lab=str(info.get("lab") or ""),
        links=[LinkEnd(str(item["node"]), str(item["ifname"])) for item in links],
        cycles=max(1, min(int(cycles), 100)),
        downSeconds=max(1.0, min(float(down), 3600)),
        upSeconds=max(1.0, min(float(up), 3600)),
        settleSeconds=max(5.0, min(float(settle), 3600)),
    )
    _jobs[job.id] = job
    _tasks[job.id] = asyncio.get_running_loop().create_task(_run(job, lab_dir))
    return job.as_dict()


def get(job_id: str) -> dict[str, Any] | None:
    job = _jobs.get(job_id)
    return job.as_dict() if job else None


def cancel(job_id: str) -> bool:
    task = _tasks.get(job_id)
    if task is None:
        return False
    task.cancel()
    return True


def history(lab_dir: Path, limit: int = 20) -> list[dict[str, Any]]:
    """Running scenarios of this lab first, then saved runs (newest first)."""
    lab = str(monitoring.stack(lab_dir).get("lab") or "")
    running = [job.as_dict() for job in _jobs.values() if job.status == "running" and job.lab == lab]
    saved = []
    for path in sorted(_dir(lab_dir).glob("*.json"), reverse=True)[:limit]:
        with contextlib.suppress(OSError, ValueError):
            data = json.loads(path.read_text())
            if data.get("status") != "running":
                saved.append(data)
    return running + saved
