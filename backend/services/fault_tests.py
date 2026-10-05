"""Fault tests written in the topology, and netlab's own validation tests run around them.

A lab can define named fault tests next to its netlab ``validate:`` tests::

    monitoring.faults:
      core_link:
        description: Lose the r1-r2 link
        links: [ r1-r2 ]            # link names, or ends like r1:eth1
        cycles: 3
        down: 10                    # seconds down, then up, per cycle
        up: 30
        during: [ ping_r3 ]         # netlab validate tests while the link is down
        validate: [ ospf, ibgp ]    # ... and after it comes back (true: all tests)
        expect.recovery: 5          # fail the run when recovery takes longer

The monitoring plugin measures what the control plane did (reaction, impact, recovery);
``netlab validate`` checks what the lab is supposed to deliver (neighbors, prefixes,
reachability), with each device's own validation plugin. Together they make a repeatable
test with a pass/fail verdict.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from services import monitoring
from services.netlab import runner

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_STATUS = re.compile(r"^\[(PASS|FAIL|WARNING|SKIPPED|WAITING|INFO|ERROR|SUCCESS|CONFIG)\]\s*(.*)$")
_HEADER = re.compile(r"^\[([^\]\s]+)\]\s+(.*?)(?:\s+\[ node\(s\):.*\])?\s*$")
_SUCCEEDED = re.compile(r"Test succeeded in ([\d.]+) seconds")
_SUMMARY = re.compile(r"tests? (completed|passed)|Tests passed", re.IGNORECASE)


def _faults_attr(attrs: dict[str, Any]) -> dict[str, Any]:
    cfg = attrs.get("monitoring")
    faults = cfg.get("faults") if isinstance(cfg, dict) else None
    faults = faults or attrs.get("monitoring.faults")
    return faults if isinstance(faults, dict) else {}


def _tests(value: Any) -> list[str] | None:
    """validate/during: None = don't run, [] = every test, else these tests."""
    if value is None or value is False:
        return None
    if value is True:
        return []
    if isinstance(value, str):
        return [value]
    return [str(v) for v in value] if isinstance(value, list) else None


def _dotted(spec: dict[str, Any], key: str) -> Any:
    """netlab accepts `expect.recovery: 5` as well as nested dicts."""
    if key in spec:
        return spec[key]
    head, _, tail = key.partition(".")
    inner = spec.get(head)
    return inner.get(tail) if tail and isinstance(inner, dict) else None


def definitions(attrs: dict[str, Any]) -> list[dict[str, Any]]:
    """The lab's named fault tests, normalized."""
    result = []
    for name, spec in _faults_attr(attrs).items():
        if not isinstance(spec, dict):
            continue
        links = spec.get("links") or []
        recovery = _dotted(spec, "expect.recovery")
        result.append(
            {
                "name": str(name),
                "description": str(spec.get("description") or ""),
                "links": [str(item) for item in (links if isinstance(links, list) else [links])],
                "cycles": int(spec.get("cycles") or 3),
                "down": float(spec.get("down") or 10),
                "up": float(spec.get("up") or 30),
                "settle": float(spec.get("settle") or 120),
                "validateAfter": _tests(spec.get("validate")),
                "validateDuring": _tests(spec.get("during")),
                "expectRecovery": float(recovery) if recovery is not None else None,
            }
        )
    return result


def resolve_links(lab_dir: Path, items: list[str]) -> list[dict[str, str]]:
    """Link names (r1-r2, as netlab names them) or ends (r1:eth1, 'r1 eth1') -> ends to take down.
    A link is taken down at its first end: the other end loses carrier with it."""
    links = monitoring.links(lab_dir)
    ends = []
    for item in items:
        text = item.strip()
        link = next((lk for lk in links if lk["link"] == text), None)
        if link:
            ends.append({"node": link["a_node"], "ifname": link["a_ifname"]})
            continue
        node, sep, ifname = text.replace(":", " ").partition(" ")
        known = any(
            (lk["a_node"], lk["a_ifname"]) == (node, ifname.strip())
            or (lk["b_node"], lk["b_ifname"]) == (node, ifname.strip())
            for lk in links
        )
        if not sep or not known:
            names = ", ".join(lk["link"] for lk in links[:12])
            raise ValueError(f"{text!r} is not a lab link or link end (links: {names}; ends look like r1:eth1)")
        ends.append({"node": node, "ifname": ifname.strip()})
    return ends


def parse_validation(text: str) -> list[dict[str, Any]]:
    """`netlab validate` output -> one result per test: passed, seconds to pass, first failure."""
    results: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw in text.splitlines():
        line = _ANSI.sub("", raw).rstrip()
        status = _STATUS.match(line)
        if status:
            kind, message = status.groups()
            if current is None or _SUMMARY.search(message):
                continue
            if kind in ("FAIL", "ERROR") and current["passed"] is not False:
                current["passed"] = False
                current["message"] = message
            elif kind == "PASS":
                seconds = _SUCCEEDED.search(message)
                if seconds:
                    current["seconds"] = float(seconds.group(1))
                if current["passed"] is None:
                    current["passed"] = True
            elif kind == "SKIPPED" and current["passed"] is None:
                current["message"] = message
            continue
        header = _HEADER.match(line)
        if header:
            current = {"test": header.group(1), "description": header.group(2), "passed": None, "seconds": None}
            current["message"] = ""
            results.append(current)
    return results


async def run_validation(lab_dir: Path, tests: list[str], *, skip_wait: bool = False) -> list[dict[str, Any]]:
    """Run netlab's validation tests (all when `tests` is empty) in the lab's directory."""
    args = ["validate", *tests, *(["--skip-wait"] if skip_wait else [])]
    result = await runner.run_command(args, cwd=lab_dir)
    parsed = parse_validation(result.stdout + "\n" + result.stderr)
    if not parsed:
        detail = (result.stderr or result.stdout).strip().splitlines()
        return [{"test": "validate", "passed": False, "seconds": None, "message": (detail or ["no output"])[-1]}]
    return parsed


def validation_tests(attrs: dict[str, Any]) -> list[dict[str, str]]:
    """netlab validation tests the topology defines: name and description."""
    tests = attrs.get("validate")
    if not isinstance(tests, dict):
        return []
    return [
        {"name": str(name), "description": str(spec.get("description") or "") if isinstance(spec, dict) else ""}
        for name, spec in tests.items()
    ]
