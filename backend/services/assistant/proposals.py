"""Proposed changes awaiting human approval.

The assistant never writes to a topology. When the agent wants to change
something it calls ``propose_topology_edit``, which replays the commands
against a *throwaway copy* of the topology, diffs the result, and parks it
here. The user sees the diff in the Assistant panel and clicks Apply, at which
point :mod:`app.assistant.router` replays the same commands through the
session's :class:`~services.topology_host.NetlabTopologyHost` — so the change
lands as one undoable step with the usual rollback-on-error behaviour.

This keeps the trust boundary crisp: tool output (device banners, configs,
routing tables) is untrusted input to the model, and nothing the model decides
from it can mutate the workspace without a human looking at a diff first.
"""

from __future__ import annotations

import difflib
import shutil
import tempfile
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from services.annotations import store as ann_store
from services.assistant.config import MAX_PROPOSALS

ProposalStatus = Literal["pending", "applied", "rejected", "stale"]
ProposalKind = Literal["edit", "action"]


@dataclass
class Proposal:
    id: str
    session_id: str
    kind: ProposalKind
    # Revision the diff was computed against; the apply endpoint refuses to
    # run when the topology has moved on, so a stale diff is never applied
    # blind.
    base_revision: int
    rationale: str
    summary: str
    status: ProposalStatus = "pending"
    # kind="edit"
    commands: list[dict[str, Any]] = field(default_factory=list)
    diff: str = ""
    # kind="action" (e.g. fault injection): described rather than diffed.
    action: dict[str, Any] | None = None
    created_at: float = field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "kind": self.kind,
            "baseRevision": self.base_revision,
            "rationale": self.rationale,
            "summary": self.summary,
            "status": self.status,
            "diff": self.diff,
            "action": self.action,
            "createdAt": self.created_at,
        }


class ProposalStore:
    """Process-local, capped store of pending/settled proposals."""

    def __init__(self, limit: int = MAX_PROPOSALS) -> None:
        self._items: OrderedDict[str, Proposal] = OrderedDict()
        self._limit = limit

    def add(self, proposal: Proposal) -> Proposal:
        self._items[proposal.id] = proposal
        while len(self._items) > self._limit:
            self._items.popitem(last=False)
        return proposal

    def get(self, proposal_id: str) -> Proposal | None:
        return self._items.get(proposal_id)

    def for_session(self, session_id: str) -> list[Proposal]:
        return [p for p in self._items.values() if p.session_id == session_id]

    def clear(self) -> None:
        self._items.clear()


store = ProposalStore()


# ------------------------------------------------------------------- previews
def preview_edit(topology_path: str, commands_list: list[dict[str, Any]]) -> tuple[str, str]:
    """Replay ``commands_list`` against a copy of the topology.

    Returns ``(after_text, unified_diff)``. The real files are never touched:
    the topology and its annotations sidecar are copied into a temp directory
    and the command dispatch runs there. Raises whatever the dispatch raises
    (unknown verb, bad payload) so the agent gets a real error to correct.
    """
    from app.contract import commands as command_dispatch

    source = Path(topology_path)
    before_text = source.read_text() if source.exists() else ""

    with tempfile.TemporaryDirectory(prefix="netlab-assistant-") as tmp:
        work = Path(tmp) / source.name
        work.write_text(before_text)
        # Commands that touch memberships/positions read the annotation files;
        # copy both so a preview behaves exactly like the real apply would.
        for src_path, dst_path in (
            (ann_store.clab_annotations_path(source), ann_store.clab_annotations_path(work)),
            (ann_store.sidecar_path(source), ann_store.sidecar_path(work)),
        ):
            if src_path.exists():
                shutil.copyfile(src_path, dst_path)

        for command in commands_list:
            command_dispatch.apply(str(work), command)

        after_text = work.read_text()

    diff = "".join(
        difflib.unified_diff(
            before_text.splitlines(keepends=True),
            after_text.splitlines(keepends=True),
            fromfile=f"a/{source.name}",
            tofile=f"b/{source.name}",
        )
    )
    return after_text, diff


def create_edit(
    *,
    session_id: str,
    topology_path: str,
    base_revision: int,
    commands_list: list[dict[str, Any]],
    rationale: str,
) -> Proposal:
    _, diff = preview_edit(topology_path, commands_list)
    if not diff:
        raise ValueError("commands produce no change to the topology")
    return store.add(
        Proposal(
            id=uuid.uuid4().hex,
            session_id=session_id,
            kind="edit",
            base_revision=base_revision,
            rationale=rationale,
            summary=summarize(commands_list),
            commands=commands_list,
            diff=diff,
        )
    )


def create_action(
    *,
    session_id: str,
    base_revision: int,
    action: dict[str, Any],
    rationale: str,
    summary: str,
) -> Proposal:
    return store.add(
        Proposal(
            id=uuid.uuid4().hex,
            session_id=session_id,
            kind="action",
            base_revision=base_revision,
            rationale=rationale,
            summary=summary,
            action=action,
        )
    )


def summarize(commands_list: list[dict[str, Any]]) -> str:
    """One-line human summary of a command batch, for the proposal card."""
    verbs: list[str] = []
    for command in commands_list:
        verb = command.get("type") or command.get("verb") or command.get("command") or "?"
        payload = command.get("payload") if isinstance(command.get("payload"), dict) else command
        if verb in {"setYamlContent", "setAnnotationsContent"}:
            # A whole-file rewrite: the verb name means nothing to the reader,
            # and the diff below the summary already says what changed.
            verbs.append("edit topology")
            continue
        if payload.get("source") and payload.get("target"):
            target = f"{payload['source']}-{payload['target']}"
        else:
            target = payload.get("id") or payload.get("oldName") or payload.get("name") or ""
        verbs.append(f"{verb} {target}".strip())
    if not verbs:
        return "no changes"
    if len(verbs) <= 3:
        return ", ".join(verbs)
    return f"{', '.join(verbs[:3])} (+{len(verbs) - 3} more)"
