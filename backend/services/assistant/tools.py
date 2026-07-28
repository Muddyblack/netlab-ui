"""Tool implementations exposed to agents over MCP.

Plain async functions with plain arguments and JSON-able returns — no MCP types
here, so they can be unit-tested by calling them. :mod:`.mcp_server` is the only
place that knows about the protocol.

Everything is read-only except :func:`propose_topology_edit` and
:func:`propose_fault_injection`, which stage a change for human approval (see
:mod:`.proposals`).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from services.assistant import exec_tool, proposals
from services.assistant.config import MAX_FILE_BYTES, MAX_OUTPUT_BYTES
from services.assistant.prompts import UNTRUSTED_PREFIX
from services.netlab import runner

# Files worth surfacing to an agent browsing a lab directory.
_INTERESTING_SUFFIXES = {".yml", ".yaml", ".j2", ".md", ".cfg", ".conf", ".txt", ".json", ".py", ".sh"}


class ToolError(RuntimeError):
    """Raised for expected failures; surfaced to the agent as tool output."""


# ------------------------------------------------------------------- helpers
def _session(session_id: str):
    # Local import: services/ must not depend on app/ at import time.
    from app.sessions.store import store

    try:
        return store.require(session_id)
    except KeyError:
        raise ToolError(f"unknown session {session_id!r} — call list_sessions for the open topologies") from None


def _untrusted(text: str) -> str:
    return UNTRUSTED_PREFIX + text


def _cap(text: str, limit: int = MAX_OUTPUT_BYTES) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[truncated, {len(text) - limit} more characters]"


# --------------------------------------------------------------------- reads
async def list_sessions() -> list[dict[str, Any]]:
    """Open editing sessions (one per topology the user has open)."""
    from app.sessions.store import store

    return [
        {
            "sessionId": session.id,
            "topologyPath": session.topology_path,
            "name": Path(session.topology_path).name,
            "revision": session.revision,
        }
        for session in store._sessions.values()
    ]


async def get_topology_yaml(session_id: str) -> dict[str, Any]:
    """The topology source file as the user wrote it (comments intact)."""
    session = _session(session_id)
    path = Path(session.topology_path)
    if not path.exists():
        raise ToolError(f"topology file does not exist: {path}")
    return {
        "path": str(path),
        "revision": session.revision,
        "yaml": _cap(path.read_text(), MAX_FILE_BYTES),
    }


async def get_topology_snapshot(session_id: str) -> dict[str, Any]:
    """The *transformed* topology: nodes, links and derived addressing.

    This is what netlab actually builds from the source YAML, so it answers
    "what IP did r1 get" — which the source file does not.
    """
    session = _session(session_id)
    from app.contract.router.sessions import build_snapshot

    snap = await build_snapshot(session)
    return {"revision": session.revision, "snapshot": snap}


async def netlab_inspect(session_id: str) -> str:
    """Full expanded netlab data model (`netlab inspect --all`)."""
    session = _session(session_id)
    result = await runner.inspect(session.topology_path)
    if result.code != 0:
        raise ToolError(result.stderr or result.stdout or "netlab inspect failed")
    return _cap(result.stdout)


async def get_lab_status(session_id: str | None = None) -> dict[str, Any]:
    """Deployment state: which labs are up, and per-node state when known."""
    if not runner.is_installed():
        raise ToolError("netlab is not installed on this host")
    if session_id:
        session = _session(session_id)
        try:
            return {"lab": await runner.status_for(session.topology_path)}
        except (runner.NetlabError, OSError, json.JSONDecodeError):
            # Not deployed: netlab has no status file to read.
            return {"lab": {}, "note": "lab does not appear to be running"}
    return {"labs": await runner.status_cached()}


async def validate_topology(session_id: str) -> dict[str, Any]:
    """Run `netlab validate` against the running lab."""
    session = _session(session_id)
    result = await runner.validate(session.topology_path)
    return {
        "exitCode": result.code,
        "output": _untrusted(_cap(result.stdout + result.stderr)),
    }


async def list_workspace_files(session_id: str) -> list[dict[str, Any]]:
    """Files next to the topology — configs, templates, docs, other labs."""
    session = _session(session_id)
    directory = Path(session.topology_path).parent
    entries: list[dict[str, Any]] = []
    for child in sorted(directory.iterdir()):
        if child.name.startswith("."):
            continue
        if child.is_dir():
            entries.append({"name": child.name, "type": "dir"})
        elif child.suffix in _INTERESTING_SUFFIXES:
            entries.append({"name": child.name, "type": "file", "bytes": child.stat().st_size})
    return entries


async def read_workspace_file(session_id: str, relative_path: str) -> str:
    """Read a file from the topology's directory tree."""
    session = _session(session_id)
    root = Path(session.topology_path).parent.resolve()
    target = (root / relative_path).resolve()
    # Containment check: the agent picks this path, and it may have picked it
    # from something it read.
    if target != root and not target.is_relative_to(root):
        raise ToolError("path escapes the topology directory")
    if not target.is_file():
        raise ToolError(f"not a file: {relative_path}")
    try:
        text = target.read_text(errors="replace")
    except OSError as exc:
        raise ToolError(str(exc)) from exc
    return _untrusted(_cap(text, MAX_FILE_BYTES))


async def write_workspace_file(
    session_id: str,
    relative_path: str,
    content: str,
) -> dict[str, Any]:
    """Create or overwrite a file (new lab topology YAML, Jinja template, config, documentation) in the topology's workspace directory tree."""
    session = _session(session_id)
    root = Path(session.topology_path).parent.resolve()
    target = (root / relative_path).resolve()
    if target != root and not target.is_relative_to(root):
        raise ToolError("path escapes the topology directory")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise ToolError(str(exc)) from exc

    from services.events import hub

    hub.publish({"type": "files"})
    return {
        "ok": True,
        "path": relative_path,
        "bytes": len(content),
    }


async def run_fcli_report(session_id: str, report: str) -> str:
    """Run one read-only nornir-srl report against the running lab."""
    session = _session(session_id)
    if report not in runner.FCLI_COMMANDS:
        raise ToolError(f"unknown report {report!r}; available: {', '.join(sorted(runner.FCLI_COMMANDS))}")
    result = await runner.fcli(session.topology_path, report)
    if result.code != 0:
        raise ToolError(result.stderr or result.stdout or "fcli failed")
    return _untrusted(_cap(result.stdout))


async def exec_on_node(session_id: str, node: str, command: str) -> str:
    """Run a read-only command on a running node and return its output."""
    session = _session(session_id)
    try:
        result = await exec_tool.exec_on_node(session.topology_path, node, command)
    except exec_tool.CommandRejected as exc:
        raise ToolError(str(exc)) from exc
    except runner.NetlabNotInstalled as exc:
        raise ToolError(str(exc)) from exc

    body = str(result.get("output") or "")
    stderr = str(result.get("stderr") or "")
    if stderr.strip():
        body += f"\n[stderr]\n{stderr}"
    if result.get("timedOut"):
        body += "\n[command timed out]"
    return _untrusted(f"$ {command}  (node {node}, exit {result.get('exitCode')})\n{body}")


async def get_node_config(session_id: str, node: str) -> str:
    """The device's running configuration, as collected by netlab."""
    return await exec_on_node(session_id, node, "show running-config")


# ------------------------------------------------------------------ proposals
async def propose_topology_edit(
    session_id: str,
    commands: list[dict[str, Any]],
    rationale: str,
) -> dict[str, Any]:
    """Stage a topology change for the user to review as a diff.

    Nothing is written. Returns the diff so the agent can describe what it
    proposed; the user applies or rejects it in the UI.
    """
    session = _session(session_id)
    if not commands:
        raise ToolError("no commands given")
    try:
        proposal = proposals.create_edit(
            session_id=session_id,
            topology_path=session.topology_path,
            base_revision=session.revision,
            commands_list=commands,
            rationale=rationale,
        )
    except ValueError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        raise ToolError(f"commands could not be applied: {exc}") from exc

    _notify(session_id, proposal)
    return {
        "proposalId": proposal.id,
        "summary": proposal.summary,
        "diff": proposal.diff,
        "status": "awaiting user approval — do not claim the change has been made",
    }


async def propose_fault_injection(
    session_id: str,
    node: str,
    interface: str,
    *,
    delay_ms: int = 0,
    jitter_ms: int = 0,
    loss_percent: float = 0.0,
    rationale: str = "",
) -> dict[str, Any]:
    """Stage a link impairment (tutor mode) for the user to apply."""
    session = _session(session_id)
    if not any((delay_ms, jitter_ms, loss_percent)):
        summary = f"clear impairments on {node}:{interface}"
    else:
        parts = []
        if delay_ms:
            parts.append(f"{delay_ms}ms delay")
        if jitter_ms:
            parts.append(f"{jitter_ms}ms jitter")
        if loss_percent:
            parts.append(f"{loss_percent}% loss")
        summary = f"{', '.join(parts)} on {node}:{interface}"

    proposal = proposals.create_action(
        session_id=session_id,
        base_revision=session.revision,
        action={
            "type": "netem",
            "node": node,
            "interface": interface,
            "delay": str(delay_ms or ""),
            "jitter": str(jitter_ms or ""),
            "loss": str(loss_percent or ""),
        },
        rationale=rationale,
        summary=summary,
    )
    _notify(session_id, proposal)
    return {
        "proposalId": proposal.id,
        "summary": proposal.summary,
        "status": "awaiting user approval — the impairment is not active yet",
    }


# ------------------------------------------------------------------- teaching
async def get_teaching_document(session_id: str) -> dict[str, Any]:
    """The guided tour attached to this topology, if any."""
    session = _session(session_id)
    from services.lenses import teaching

    return teaching.load(session.topology_path)


async def create_teaching_document(
    session_id: str,
    title: str,
    steps: list[dict[str, Any]],
) -> dict[str, Any]:
    """Write a guided tour (title + captioned steps) for this topology."""
    session = _session(session_id)
    from services.lenses import teaching

    document = {
        "schemaVersion": 2,
        "id": "default",
        "title": title,
        "steps": [
            {
                "id": step.get("id") or f"step-{index + 1}",
                "caption": step.get("caption", ""),
                "note": step.get("note", ""),
                "view": step.get("view") or {"lens": "physical"},
            }
            for index, step in enumerate(steps)
        ],
    }
    saved = teaching.save(session.topology_path, document)
    return {"ok": True, "document": saved}


# ------------------------------------------------------------------- context
async def get_selection_context(session_id: str) -> dict[str, Any]:
    """What the user currently has selected on the canvas."""
    from services.assistant import chat

    return {"selection": chat.manager.selection_for(session_id)}


def _notify(session_id: str, proposal: proposals.Proposal) -> None:
    """Push a new proposal to any chat watching this session."""
    from services.assistant import chat

    chat.manager.notify_proposal(session_id, proposal)
