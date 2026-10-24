"""Bounded, per-node deployment state derived from netlab/Ansible output."""

from __future__ import annotations

import re
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock

_ANSIBLE_EVENT = re.compile(r"\b(ok|changed|fatal|failed|unreachable|skipping):\s*\[([^\]]+)\](.*)", re.I)
_TASK = re.compile(r"^(?:TASK|RUNNING HANDLER)\s*\[(.+?)]", re.I)
_PLAY = re.compile(r"^PLAY\s*\[(.+?)]", re.I)
_RECAP_VALUE = re.compile(r"(ok|changed|unreachable|failed|skipped|rescued|ignored)=(\d+)", re.I)
_TOKENS = re.compile(r"[A-Za-z0-9_.:-]+")

_MAX_EVENTS = 5_000
_MAX_NODE_DETAIL_EVENTS = 50
_MAX_MESSAGE_LENGTH = 1_000
_MAX_LOG_LINES = 5_000
_STATES = ("queued", "creating", "configuring", "ready", "failed", "stopping", "stopped")


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class _NodeProgress:
    state: str
    current_task: str | None = None
    last_error: str | None = None
    recap: dict[str, int] = field(
        default_factory=lambda: {
            "ok": 0,
            "changed": 0,
            "unreachable": 0,
            "failed": 0,
            "skipped": 0,
            "rescued": 0,
            "ignored": 0,
        }
    )


class DeploymentProgressTracker:
    """Track one lifecycle run with O(1) Ansible event updates.

    Node summaries are retained for every node, while verbose history is held
    in one globally bounded ring buffer. This keeps memory predictable even for
    very large labs and lets the API return history only for a selected node.
    """

    def __init__(self, action: str, nodes: list[str]) -> None:
        self.action = action
        initial = "stopping" if action == "down" else "queued"
        self._nodes = {node: _NodeProgress(state=initial) for node in nodes}
        self.states = dict.fromkeys(nodes, initial)  # Backwards-compatible public summary.
        self.running = True
        self.done = False
        self.exit_code: int | None = None
        self.stage = self._initial_stage(action)
        self.current_task: str | None = None
        self.started_at = _now()
        self.finished_at: str | None = None
        self._events: deque[dict[str, object]] = deque(maxlen=_MAX_EVENTS)
        # Verbatim command output for the "view last run output" panel, so the
        # transcript survives after clab-ui's transient progress modal is closed.
        self._log: deque[dict[str, str]] = deque(maxlen=_MAX_LOG_LINES)
        self._sequence = 0
        self._delta_nodes = set(nodes)
        self._lock = RLock()

    @staticmethod
    def _initial_stage(action: str) -> str:
        if action == "down":
            return "stopping"
        if action == "initial":
            return "configuring"
        if action == "create-configs":
            return "generating"
        return "preparing"

    def _set_state(self, node: str, state: str) -> None:
        progress = self._nodes.get(node)
        if progress is None or progress.state == state:
            return
        progress.state = state
        self.states[node] = state
        self._delta_nodes.add(node)

    def _record_event(self, node: str, status: str, message: str | None = None) -> None:
        progress = self._nodes[node]
        progress.current_task = self.current_task
        self._sequence += 1
        self._events.append(
            {
                "sequence": self._sequence,
                "timestamp": _now(),
                "node": node,
                "status": status,
                "task": self.current_task,
                "message": message[:_MAX_MESSAGE_LENGTH] if message else None,
            }
        )

    def _feed_ansible_event(self, match: re.Match[str]) -> None:
        status = match.group(1).lower()
        node = match.group(2)
        if node not in self._nodes:
            return
        message = re.sub(r"^(?:FAILED!\s*)?(?:=>\s*)?", "", match.group(3).strip(" :"), flags=re.I) or None
        progress = self._nodes[node]
        if status == "ok":
            progress.recap["ok"] += 1
        elif status == "changed":
            progress.recap["ok"] += 1
            progress.recap["changed"] += 1
        elif status == "skipping":
            progress.recap["skipped"] += 1
        elif status == "unreachable":
            progress.recap["unreachable"] += 1
        else:
            progress.recap["failed"] += 1
        if status in {"fatal", "failed", "unreachable"}:
            progress.last_error = message or status
            self._set_state(node, "failed")
        else:
            self._set_state(node, "configuring")
        self.stage = "configuring"
        self._record_event(node, status, message)

    def _feed_recap(self, node: str, recap_text: str) -> bool:
        """Update ``node``'s recap counters from a ``node : k=v k=v`` line.
        Returns whether it actually looked like a recap line, so callers can
        fall back to generic parsing for ordinary ``label: message`` lines."""
        if node not in self._nodes:
            return False
        values = {name.lower(): int(value) for name, value in _RECAP_VALUE.findall(recap_text)}
        if not values:
            return False
        self._nodes[node].recap.update(values)
        failed = values.get("failed", 0) or values.get("unreachable", 0)
        self._set_state(node, "failed" if failed else "ready")
        self._record_event(node, "recap", recap_text.strip())
        return True

    def _feed_generic(self, line: str) -> None:
        lowered = line.lower()
        if "config" in lowered and any(word in lowered for word in ("creat", "generat", "render")):
            self.stage = "generating"
        elif any(word in lowered for word in ("containerlab", "creating lab", "deploying", "starting lab")):
            self.stage = "creating"

        # Token lookup is O(words in the line), unlike scanning every topology
        # node for every log line (which becomes quadratic on large labs).
        mentioned = {token for token in _TOKENS.findall(line) if token in self._nodes}
        for node in mentioned:
            if any(word in lowered for word in ("error", "fatal", "failed")):
                self._nodes[node].last_error = line.strip()[:_MAX_MESSAGE_LENGTH]
                self._set_state(node, "failed")
            elif any(word in lowered for word in ("creat", "start", "deploy")) and self.states[node] == "queued":
                self._set_state(node, "creating")

    def feed(self, line: str) -> bool:
        with self._lock:
            before_stage = self.stage
            task = _TASK.match(line.strip())
            if task:
                self.current_task = task.group(1)
                self.stage = "configuring"
            elif _PLAY.match(line.strip()):
                self.stage = "configuring"

            event = _ANSIBLE_EVENT.search(line)
            node, separator, recap_text = line.strip().partition(":")
            node = node.strip()
            recap = bool(separator and node and not any(char.isspace() for char in node))
            if event:
                self._feed_ansible_event(event)
            elif not (recap and self._feed_recap(node, recap_text)):
                self._feed_generic(line)
            return bool(self._delta_nodes) or self.stage != before_stage or task is not None

    def record_log(self, stream: str, line: str) -> None:
        """Append one raw output line (``stdout``/``stderr``) to the retained
        transcript. Bounded by ``_MAX_LOG_LINES`` so long runs stay memory-safe."""
        with self._lock:
            self._log.append(
                {
                    "stream": "stderr" if stream == "stderr" else "stdout",
                    "line": line,
                    "section": self.stage,
                }
            )

    def finish(self, code: int) -> None:
        with self._lock:
            for node, progress in self._nodes.items():
                if progress.state == "failed":
                    continue
                if code != 0:
                    self._set_state(node, "failed")
                elif self.action == "down":
                    self._set_state(node, "stopped")
                else:
                    self._set_state(node, "ready")
            self.exit_code = code
            self.running = False
            self.done = True
            self.finished_at = _now()
            self.stage = "complete" if code == 0 else "failed"

    def _summary(self) -> dict[str, int]:
        counts = Counter(self.states.values())
        return {"total": len(self.states), **{state: counts[state] for state in _STATES}}

    def payload(self, *, delta: bool = False) -> dict[str, object]:
        with self._lock:
            node_names = self._delta_nodes if delta else self.states.keys()
            nodes = {node: self.states[node] for node in node_names}
            if delta:
                self._delta_nodes.clear()
            return {
                "available": True,
                "action": self.action,
                "running": self.running,
                "done": self.done,
                "exitCode": self.exit_code,
                "stage": self.stage,
                "currentTask": self.current_task,
                "startedAt": self.started_at,
                "finishedAt": self.finished_at,
                "summary": self._summary(),
                "nodes": nodes,
            }

    def log_payload(self) -> dict[str, object]:
        with self._lock:
            return {
                "available": True,
                "action": self.action,
                "running": self.running,
                "done": self.done,
                "exitCode": self.exit_code,
                "startedAt": self.started_at,
                "finishedAt": self.finished_at,
                "lines": list(self._log),
            }

    def node_detail(self, node: str) -> dict[str, object]:
        with self._lock:
            progress = self._nodes.get(node)
            if progress is None:
                return {"available": False, "node": node}
            events = [
                {key: value for key, value in event.items() if key != "node"}
                for event in self._events
                if event["node"] == node
            ][-_MAX_NODE_DETAIL_EVENTS:]
            return {
                "available": True,
                "node": node,
                "state": progress.state,
                "currentTask": progress.current_task,
                "lastError": progress.last_error,
                "recap": dict(progress.recap),
                "events": events,
            }
