"""HTTP surface for AI agents: MCP connection details, agent terminals and
change proposals.

netlab-ui has no chat of its own. Users point their own agent (Claude Code,
Codex, Gemini CLI, Cursor, …) at the MCP server, or have netlab-ui start the
agent's own CLI in a terminal tab; this router tells the UI how to connect one
and lets the user apply or reject what an agent proposed. The one piece of real
logic here is applying an approved proposal, because that is where an agent
crosses from reading into writing and has to go through the session's topology
host to stay undoable.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket
from pydantic import BaseModel

from app import auth
from app.assistant.responses import (
    AssistantAck,
    AssistantCapabilities,
    AssistantProposalList,
    AssistantProposalResult,
)
from app.sessions.store import store
from services.assistant import guide, harness, mcp_server, proposals, tools
from services.assistant.config import mcp_base_url, mcp_token
from services.events import hub
from services.netlab import runner

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/capabilities", response_model=AssistantCapabilities)
def capabilities(request: Request):
    """What the AI agents panel needs to show how to connect an agent."""
    base = str(request.base_url)  # the address the UI reached us on, whatever the port
    return {
        "enabled": True,
        "mcp": {
            "url": mcp_base_url(base),
            "authHeader": f"Bearer {mcp_token()}",
            "tools": mcp_server.tool_names(),
            "clientConfig": mcp_server.describe_config(base),
        },
        "harnesses": harness.available(),
        "harnessesAllowed": _harness_allowed(request.client.host if request.client else None),
    }


def _harness_allowed(client_host: str | None) -> bool:
    """Agent terminals run the user's agent, logged in as them, on the backend
    host. Without a login in front of netlab-ui, only allow that from the same
    machine: anyone else who can reach the port would get the user's agent."""
    if auth.configured_users():
        return True
    return client_host in {"127.0.0.1", "::1", "localhost"}


@router.websocket("/harness/{harness_id}/terminal")
async def harness_terminal(websocket: WebSocket, harness_id: str, sessionId: str):
    """The user's own agent CLI in a PTY, started in the lab's directory and
    connected to the MCP server. The UI is the CLI's own terminal interface."""
    from app.shell.ws import bridge_pty

    await websocket.accept()
    selected = harness.get(harness_id)
    if selected is None:
        await websocket.send_text(f"\r\n[unknown agent {harness_id!r}]\r\n")
        await websocket.close()
        return
    if not _harness_allowed(websocket.client.host if websocket.client else None):
        await websocket.send_text(
            "\r\n[agent terminals are only available from the netlab-ui host itself unless a login is "
            "configured (NETLAB_UI_AUTH)]\r\n"
        )
        await websocket.close()
        return
    session = store.get(sessionId)
    if session is None:
        await websocket.send_text("\r\n[unknown session — reopen the lab]\r\n")
        await websocket.close()
        return
    try:
        # The agent runs on this host: point it at the address the UI used (ws → http).
        base = websocket.base_url.replace(scheme="https" if websocket.url.scheme == "wss" else "http")
        argv, env = harness.launch_spec(selected, str(base))
    except FileNotFoundError as exc:
        await websocket.send_text(f"\r\n[{exc}]\r\n")
        await websocket.close()
        return
    await bridge_pty(websocket, argv, Path(session.topology_path).parent, env)


class Selection(BaseModel):
    sessionId: str
    nodes: list[str] = []


@router.post("/selection", response_model=AssistantAck)
def set_selection(body: Selection):
    """Tell agents what the user has selected on the canvas."""
    tools.set_selection(body.sessionId, body.nodes)
    return {"ok": True}


class UiAction(BaseModel):
    id: str
    label: str
    detail: str = ""


class UiActions(BaseModel):
    sessionId: str
    actions: list[UiAction] = []


@router.post("/ui-actions", response_model=AssistantAck)
def set_ui_actions(body: UiActions):
    """What the user's UI can open for this lab, so agents can show them around."""
    guide.set_ui_actions(body.sessionId, [action.model_dump() for action in body.actions])
    return {"ok": True}


# ----------------------------------------------------------------- proposals
@router.get("/proposals", response_model=AssistantProposalList)
def list_proposals(session_id: str = Query(alias="sessionId")):
    return {"proposals": [p.as_dict() for p in proposals.store.for_session(session_id)]}


@router.post("/proposals/{proposal_id}/apply", response_model=AssistantProposalResult)
async def apply_proposal(proposal_id: str):
    """Apply an approved proposal — an agent's only path to a topology write."""
    proposal = _require_proposal(proposal_id)
    if proposal.status != "pending":
        raise HTTPException(409, f"proposal is already {proposal.status}")

    session = store.get(proposal.session_id)
    if session is None:
        raise HTTPException(404, "unknown session")

    # The diff the user approved was computed against base_revision. If the
    # topology moved since, applying it could mean something different than
    # what they saw.
    if session.revision != proposal.base_revision:
        proposal.status = "stale"
        tools.notify_proposals(proposal.session_id)
        raise HTTPException(409, "the topology changed since this was proposed; ask the agent for an updated proposal")

    if proposal.kind == "action":
        await _run_action(proposal)
        proposal.status = "applied"
        tools.notify_proposals(proposal.session_id)
        return {"ok": True, "proposal": proposal.as_dict(), "revision": session.revision}

    # Multiple commands go in as one batch so undo reverses the whole proposal.
    command: dict[str, Any] = (
        proposal.commands[0] if len(proposal.commands) == 1 else {"type": "batch", "commands": proposal.commands}
    )
    result = session.host.apply_command(command)
    if not result.ok:
        return {
            "ok": False,
            "proposal": proposal.as_dict(),
            "revision": session.revision,
            "error": result.error or "command failed",
        }

    proposal.status = "applied"
    tools.notify_proposals(proposal.session_id)
    hub.publish({"type": "files"})
    return {"ok": True, "proposal": proposal.as_dict(), "revision": result.revision}


@router.post("/proposals/{proposal_id}/reject", response_model=AssistantProposalResult)
def reject_proposal(proposal_id: str):
    proposal = _require_proposal(proposal_id)
    if proposal.status == "pending":
        proposal.status = "rejected"
        tools.notify_proposals(proposal.session_id)
    return {"ok": True, "proposal": proposal.as_dict()}


def _require_proposal(proposal_id: str) -> proposals.Proposal:
    proposal = proposals.store.get(proposal_id)
    if proposal is None:
        raise HTTPException(404, "unknown proposal")
    return proposal


async def _run_action(proposal: proposals.Proposal) -> None:
    """Execute a non-edit proposal (currently: netem link impairment)."""
    action = proposal.action or {}
    if action.get("type") != "netem":
        raise HTTPException(400, f"unsupported action {action.get('type')!r}")

    session = store.get(proposal.session_id)
    node = str(action.get("node") or "")
    status = await runner.status_for(session.topology_path) if session else {}
    nodes = status.get("nodes", {}) if isinstance(status, dict) else {}
    info = (nodes.get(node) or {}) if isinstance(nodes, dict) else {}
    # netlab's status names the container `provider_name`.
    container = info.get("provider_name") or info.get("container")
    if not container:
        raise HTTPException(409, f"node {node!r} is not running under containerlab")

    result = await runner.netem_set(
        container,
        str(action.get("interface") or ""),
        delay=str(action.get("delay") or ""),
        jitter=str(action.get("jitter") or ""),
        loss=str(action.get("loss") or ""),
    )
    if result.code != 0:
        raise HTTPException(500, result.stderr or "netem failed")
