"""Per-session topology host with undo/redo history.

This is a Python port of the *history engine* in clab-ui's public
``TopologyHostCore`` implementation. That engine is format-agnostic: it
snapshots the topology YAML and the annotations
sidecar as opaque strings (``captureHistoryEntry``) and restores them on
undo/redo (``restoreHistoryEntry``). We keep netlab's own parser/serializer for
the actual mutations (``app.contract.commands``); this class only owns the
``past``/``future`` history stacks, the rename merge-window, and the
``revision`` counter — exactly the pieces the netlab backend was missing and the
reason the clab-ui Navbar's undo/redo buttons stayed dead.

Mutations flow through :meth:`apply_command`; bulk/authoring mutations that don't
go through the command dispatch (``put_model``, template instantiate) wrap their
work in :meth:`transaction` so they remain a single undoable step.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services import annotations as ann_store

DEFAULT_HISTORY_LIMIT = 50
# A burst of single-character rename keystrokes should collapse into one undo
# step (mirrors RENAME_HISTORY_MERGE_WINDOW_MS in TopologyHostCore.ts).
RENAME_MERGE_WINDOW_S = 0.8

# Transient/non-meaningful commands that must never create an undo checkpoint.
# Live drags ("move"/"position") are superseded by the drag-end "savePositions";
# viewer settings (zoom/pan) are not user-meaningful edits.
_ALWAYS_SKIP = {"move", "position", "setViewerSettings"}
# Commands that record history *unless* the caller flags them as a live/internal
# update via ``skipHistory`` (mirrors shouldSkipHistory in TopologyHostCore.ts).
_FLAG_SKIP = {
    "savePositions",
    "savePositionsWithMemberships",
    "savePositionsAndAnnotations",
    "setYamlContent",
    "setAnnotationsContent",
}


@dataclass
class _HistoryEntry:
    yaml_text: str
    clab_annotations_text: str | None  # ``None`` == file absent
    gui_annotations_text: str | None  # ``None`` == file absent


@dataclass
class ApplyResult:
    ok: bool
    revision: int
    error: str | None = None
    # ``stale`` lets the caller distinguish a rejected (no-op) command from a
    # genuine error; reserved for future baseRevision enforcement.
    stale: bool = False


def _verb(command: dict[str, Any]) -> str | None:
    return command.get("type") or command.get("verb") or command.get("command")


def _flat(command: dict[str, Any]) -> dict[str, Any]:
    """clab-ui nests args under ``payload``; flatten for field inspection (the
    same flattening :func:`commands.apply` does internally)."""
    payload = command.get("payload")
    if isinstance(payload, dict):
        return {**command, **payload}
    return command


def _is_rename_edit(verb: str | None, command: dict[str, Any]) -> bool:
    if verb != "editNode":
        return False
    flat = _flat(command)
    old_name = str(flat.get("oldName") or "").strip()
    new_name = str(flat.get("name") or "").strip()
    return bool(old_name) and bool(new_name) and old_name != new_name


def _skip_history(verb: str | None, command: dict[str, Any]) -> bool:
    if verb in _ALWAYS_SKIP:
        return True
    if verb in _FLAG_SKIP:
        flat = _flat(command)
        return bool(command.get("skipHistory") or flat.get("skipHistory"))
    return False


class NetlabTopologyHost:
    """Owns history + revision for a single editing session's topology file."""

    def __init__(self, topology_path: str, history_limit: int = DEFAULT_HISTORY_LIMIT) -> None:
        self.path = topology_path
        self.revision = 1
        self.history_limit = history_limit
        self._past: list[_HistoryEntry] = []
        self._future: list[_HistoryEntry] = []
        self._merge_until: float | None = None

    # ------------------------------------------------------------------ flags
    @property
    def can_undo(self) -> bool:
        return len(self._past) > 0

    @property
    def can_redo(self) -> bool:
        return len(self._future) > 0

    # --------------------------------------------------------------- capture
    def _capture(self) -> _HistoryEntry:
        yaml_text = Path(self.path).read_text() if Path(self.path).exists() else ""
        clab_path = ann_store.clab_annotations_path(self.path)
        gui_path = ann_store.sidecar_path(self.path)
        return _HistoryEntry(
            yaml_text=yaml_text,
            clab_annotations_text=clab_path.read_text() if clab_path.exists() else None,
            gui_annotations_text=gui_path.read_text() if gui_path.exists() else None,
        )

    def _restore(self, entry: _HistoryEntry) -> None:
        Path(self.path).write_text(entry.yaml_text)
        for text, path in (
            (entry.clab_annotations_text, ann_store.clab_annotations_path(self.path)),
            (entry.gui_annotations_text, ann_store.sidecar_path(self.path)),
        ):
            if text is None:
                path.unlink(missing_ok=True)
            else:
                path.write_text(text)

    def _push(self, entry: _HistoryEntry) -> None:
        self._past.append(entry)
        if len(self._past) > self.history_limit:
            self._past.pop(0)

    # ----------------------------------------------------------------- apply
    def apply_command(self, command: dict[str, Any]) -> ApplyResult:
        verb = _verb(command)

        if verb == "undo":
            self._merge_until = None
            return self._undo_redo("undo")
        if verb == "redo":
            self._merge_until = None
            return self._undo_redo("redo")

        from app.contract import commands  # local import: services must not depend on app at import time

        before = self._capture()
        try:
            commands.apply(self.path, command)
        except Exception as exc:  # noqa: BLE001 — surface message, roll back files
            self._restore(before)
            return ApplyResult(ok=False, revision=self.revision, error=str(exc))

        now = time.monotonic()
        merge = self._merge_until is not None and now <= self._merge_until
        skip = _skip_history(verb, command)
        if not merge and not skip:
            self._push(before)

        if _is_rename_edit(verb, command):
            self._merge_until = now + RENAME_MERGE_WINDOW_S
        elif self._merge_until is not None and now > self._merge_until:
            self._merge_until = None

        self._future.clear()
        self.revision += 1
        return ApplyResult(ok=True, revision=self.revision)

    def _undo_redo(self, direction: str) -> ApplyResult:
        stack = self._past if direction == "undo" else self._future
        if not stack:
            # Nothing to do — ack at the current revision so the UI stays synced.
            return ApplyResult(ok=True, revision=self.revision)

        current = self._capture()
        entry = stack.pop()
        (self._future if direction == "undo" else self._past).append(current)

        try:
            self._restore(entry)
        except Exception as exc:  # noqa: BLE001
            return ApplyResult(ok=False, revision=self.revision, error=str(exc))

        self.revision += 1
        return ApplyResult(ok=True, revision=self.revision)

    # ----------------------------------------------------------- transaction
    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Wrap an out-of-band mutation (template instantiate, raw YAML save) so
        it becomes a single undoable checkpoint with rollback on failure."""
        before = self._capture()
        try:
            yield
        except Exception:
            self._restore(before)
            raise
        self._push(before)
        self._merge_until = None
        self._future.clear()
        self.revision += 1

    # -------------------------------------------------------- external change
    def on_external_change(self) -> None:
        """The file changed underneath us (e.g. a CLI run rewrote it); history is
        no longer trustworthy, so drop it and bump the revision."""
        self._past.clear()
        self._future.clear()
        self._merge_until = None
        self.revision += 1
