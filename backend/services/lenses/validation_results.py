"""Parse and cache structured per-test results from ``netlab validate``.

``netlab validate`` prints one section per topology validation test. The exact
prose varies across netlab releases and device plugins, so this parser is
deliberately tolerant: it anchors on the stable test *name* (which we also know
from the transformed topology's ``validate:`` block) and classifies the nearest
PASS / FAIL / WARN outcome token, capturing the surrounding lines as evidence.

Results are cached per topology, invalidated when the source YAML changes — the
same contract as :mod:`services.netlab.validation`.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_PASS_RE = re.compile(r"\b(pass(?:ed)?|ok|success(?:ful)?)\b", re.IGNORECASE)
_FAIL_RE = re.compile(r"\b(fail(?:ed|ure)?|error|abort(?:ed)?)\b", re.IGNORECASE)
_WARN_RE = re.compile(r"\b(warn(?:ing)?)\b", re.IGNORECASE)

State = Literal["passed", "failed", "warning", "unknown"]


def _topology_hash(path: str | Path) -> str:
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return ""


def _classify(text: str) -> State | None:
    # FAIL wins over WARN wins over PASS when a single line carries several
    # tokens (e.g. "1 test failed, 2 passed") so a mixed summary never reads
    # as a clean pass.
    if _FAIL_RE.search(text):
        return "failed"
    if _WARN_RE.search(text):
        return "warning"
    if _PASS_RE.search(text):
        return "passed"
    return None


def parse(output: str, test_names: list[str]) -> dict[str, dict[str, Any]]:
    """Return ``{test_name: {"state", "evidence"}}`` for the tests netlab ran.

    ``test_names`` are the known tests from the transformed topology; only lines
    inside a recognized test's section contribute to its outcome, so unrelated
    banner text cannot flip a result.
    """
    if not test_names:
        return {}
    ordered = sorted(test_names, key=len, reverse=True)
    name_pattern = re.compile(r"(?<![\w.-])(" + "|".join(re.escape(name) for name in ordered) + r")(?![\w.-])")
    results: dict[str, dict[str, Any]] = {}
    current: str | None = None
    for raw_line in output.splitlines():
        line = _ANSI_RE.sub("", raw_line).strip()
        if not line:
            continue
        match = name_pattern.search(line)
        if match:
            current = match.group(1)
            results.setdefault(current, {"state": "unknown", "evidence": []})
        if current is None:
            continue
        entry = results.setdefault(current, {"state": "unknown", "evidence": []})
        # Keep the section's diagnostic lines so the UI can expand a failure to
        # show what netlab actually reported, capped to stay compact.
        if len(entry["evidence"]) < 8:
            entry["evidence"].append(line)
        state = _classify(line)
        # First decisive outcome sticks unless a later line escalates to a
        # failure (a retry that ultimately fails should read as failed).
        if state is not None and (entry["state"] == "unknown" or (state == "failed" and entry["state"] != "failed")):
            entry["state"] = state
    return results


_cache: dict[str, tuple[str, dict[str, Any]]] = {}


def store(path: str | Path, output: str, test_names: list[str]) -> dict[str, Any]:
    payload = {
        "results": parse(output, test_names),
        "ranAt": datetime.now(UTC).isoformat(),
    }
    _cache[str(path)] = (_topology_hash(path), payload)
    return payload


def current(path: str | Path) -> dict[str, Any]:
    cached = _cache.get(str(path))
    if not cached or cached[0] != _topology_hash(path):
        return {"results": {}, "ranAt": None}
    return cached[1]
