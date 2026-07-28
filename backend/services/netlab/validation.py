"""Parse and cache the latest ``netlab validate`` diagnostics per topology.

The CLI output is intentionally treated as text: netlab releases and user
validation plugins can emit different prose, but node/link names remain the
stable identifiers we can project onto the canvas.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_PROBLEM_RE = re.compile(r"\b(error|fatal|fail(?:ed|ure)?|invalid|warning|warn)\b", re.IGNORECASE)


@dataclass(frozen=True)
class ValidationIssue:
    severity: Literal["error", "warning"]
    message: str
    entity_type: Literal["node", "link", "topology"]
    entity_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "message": self.message,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
        }


_cache: dict[str, tuple[str, list[ValidationIssue]]] = {}


def topology_hash(path: str | Path) -> str:
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return ""


def parse(output: str, node_names: list[str], links: list[tuple[str, str]]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for raw_line in output.splitlines():
        line = _ANSI_RE.sub("", raw_line).strip()
        match = _PROBLEM_RE.search(line)
        if not line or not match:
            continue
        severity: Literal["error", "warning"] = "warning" if match.group(1).lower().startswith("warn") else "error"

        mentioned_nodes = [node for node in node_names if re.search(rf"(?<![\w]){re.escape(node)}(?![\w])", line)]
        linked = next(
            ((left, right) for left, right in links if left in mentioned_nodes and right in mentioned_nodes),
            None,
        )
        if linked:
            issues.append(ValidationIssue(severity, line, "link", f"{linked[0]}--{linked[1]}"))
        elif mentioned_nodes:
            for node in mentioned_nodes:
                issues.append(ValidationIssue(severity, line, "node", node))
        else:
            issues.append(ValidationIssue(severity, line, "topology"))
    return issues


def store(path: str | Path, output: str, node_names: list[str], links: list[tuple[str, str]]) -> list[ValidationIssue]:
    issues = parse(output, node_names, links)
    _cache[str(path)] = (topology_hash(path), issues)
    return issues


def current(path: str | Path) -> list[ValidationIssue]:
    cached = _cache.get(str(path))
    if not cached or cached[0] != topology_hash(path):
        return []
    return cached[1]


def store_failure(path: str | Path, message: str) -> list[ValidationIssue]:
    """Persist an unclassified transform failure so preflight can never fail silently."""
    clean = _ANSI_RE.sub("", message).strip() or "netlab topology validation failed"
    issue = ValidationIssue("error", clean, "topology")
    _cache[str(path)] = (topology_hash(path), [issue])
    return [issue]
