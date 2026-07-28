"""HTTP surface for the assistant panel.

Thin, per the backend's convention: chat plumbing lives in
``services/assistant/chat.py``, proposals in ``services/assistant/proposals.py``.
The one piece of real logic here is applying an approved proposal, because that
is where the assistant crosses from reading into writing and has to go through
the session's topology host to stay undoable.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from starlette.responses import StreamingResponse

from app.assistant.responses import (
    AssistantAck,
    AssistantCapabilities,
    AssistantChatInfo,
    AssistantChatList,
    AssistantHistory,
    AssistantModelList,
    AssistantProposalList,
    AssistantProposalResult,
    AssistantProviderSettings,
)
from app.lab.common import SSE_HEADERS
from app.sessions.store import store
from services.assistant import chat as chat_service
from services.assistant import mcp_server, proposals
from services.assistant import settings as settings_service
from services.assistant.config import HEARTBEAT_S, mcp_base_url, mcp_token
from services.assistant.providers import detect_providers, list_models
from services.assistant.providers.openai_presets import PRESET_IDS
from services.events import hub
from services.netlab import runner

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

# Providers configurable from the settings dialog — the CLI agents (Claude
# Code, Codex, agy) have no keys to set, they authenticate themselves via their
# own login. ``openai_compat`` additionally needs a base URL; the vendor
# presets (Grok, DeepSeek, Kimi, GLM) take just a key.
_CONFIGURABLE_PROVIDERS = {"gemini", "openai", "openai_compat", *PRESET_IDS}
# Providers with a model to pick, a superset of the above: the CLI agents each
# take a model flag too, just no API key/base URL.
_MODEL_SELECTABLE_PROVIDERS = _CONFIGURABLE_PROVIDERS | {"claude", "codex", "agy"}


@router.get("/capabilities", response_model=AssistantCapabilities)
def capabilities():
    """What the frontend needs to decide whether to show the Assistant tab."""
    return {
        "enabled": True,
        "providers": [info.as_dict() for info in detect_providers()],
        "modes": ["ask", "plan", "build", "tutor"],
        "mcp": {
            "url": mcp_base_url(),
            "authHeader": f"Bearer {mcp_token()}",
            "tools": mcp_server.tool_names(),
            "clientConfig": mcp_server.describe_config(),
        },
    }


# ----------------------------------------------------------------------- chat
class CreateChat(BaseModel):
    providerId: str
    sessionId: str
    mode: str = "ask"
    model: str = ""


class SendMessage(BaseModel):
    text: str
    selection: list[str] | None = None


@router.get("/chats", response_model=AssistantChatList)
def list_chats(session_id: str = Query(alias="sessionId")):
    return {"chats": [chat.as_dict() for chat in chat_service.manager.for_session(session_id)]}


@router.post("/chats", response_model=AssistantChatInfo)
def create_chat(body: CreateChat):
    if store.get(body.sessionId) is None:
        raise HTTPException(404, "unknown session")
    try:
        chat = chat_service.manager.create(body.providerId, body.sessionId, body.mode, body.model)
    except chat_service.ChatError as exc:
        raise HTTPException(400, str(exc)) from exc
    return chat.as_dict()


@router.get("/chats/{chat_id}", response_model=AssistantHistory)
def get_chat(chat_id: str):
    """Replay a chat for a panel that mounted (or reconnected) mid-conversation."""
    try:
        chat = chat_service.manager.get(chat_id)
    except chat_service.ChatError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"chat": chat.as_dict(), "events": chat.history}


@router.post("/chats/{chat_id}/messages", response_model=AssistantAck, status_code=202)
async def send_message(chat_id: str, body: SendMessage):
    try:
        await chat_service.manager.send(chat_id, body.text, body.selection)
    except chat_service.ChatError as exc:
        # "still working" is a conflict, everything else is a bad request.
        status = 409 if "still working" in str(exc) else 400
        raise HTTPException(status, str(exc)) from exc
    return {"ok": True}


@router.post("/chats/{chat_id}/cancel", response_model=AssistantAck)
async def cancel_turn(chat_id: str):
    try:
        await chat_service.manager.cancel(chat_id)
    except chat_service.ChatError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


class SwitchProvider(BaseModel):
    providerId: str
    model: str = ""


@router.post("/chats/{chat_id}/provider", response_model=AssistantChatInfo)
async def switch_chat_provider(chat_id: str, body: SwitchProvider):
    """Point an existing chat at a different provider/model, keeping its
    transcript — the same visible thread continues under a new backend."""
    try:
        chat = await chat_service.manager.switch_provider(chat_id, body.providerId, body.model)
    except chat_service.ChatError as exc:
        status = 409 if "still working" in str(exc) else 400
        raise HTTPException(status, str(exc)) from exc
    return chat.as_dict()


@router.delete("/chats/{chat_id}", response_model=AssistantAck)
async def delete_chat(chat_id: str):
    await chat_service.manager.delete(chat_id)
    return {"ok": True}


@router.get("/chats/{chat_id}/events")
async def chat_events(chat_id: str, replay: bool = False):
    """Live event stream for one chat.

    Frames match the provider events (``text_delta``, ``tool_call``,
    ``proposal``, ``turn_done``…). With ``?replay=1`` the stream first replays
    the chat's history and then continues live, skipping any frame it already
    replayed (matched by ``seq``) — so a panel reconnecting mid-turn loses
    nothing. Without it, only live frames are sent.
    """
    try:
        chat = chat_service.manager.get(chat_id)
    except chat_service.ChatError as exc:
        raise HTTPException(404, str(exc)) from exc

    return StreamingResponse(sse_frames(chat, replay=replay), media_type="text/event-stream", headers=SSE_HEADERS)


async def sse_frames(chat: chat_service.Chat, *, replay: bool = False) -> AsyncIterator[str]:
    """Yield one SSE frame per event published to ``chat``, forever."""
    queue = chat.hub.subscribe()
    try:
        last_seq = 0
        if replay:
            # Subscribe (above) before snapshotting so nothing published in the
            # meantime is dropped; anything caught in both the snapshot and the
            # live queue is de-duplicated by ``seq`` below.
            for frame in list(chat.history):
                last_seq = max(last_seq, frame.get("seq", 0))
                yield f"data: {json.dumps(frame)}\n\n"
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
            except TimeoutError:
                # Comment frame: keeps proxies from dropping an idle stream
                # while the agent is thinking.
                yield ": keepalive\n\n"
                continue
            # Only de-duplicate against what replay already sent; without replay
            # (last_seq == 0) every live frame passes through, including frames
            # published directly onto the hub that carry no ``seq``.
            if last_seq and frame.get("seq", 0) <= last_seq:
                continue
            yield f"data: {json.dumps(frame)}\n\n"
    finally:
        chat.hub.unsubscribe(queue)


class Selection(BaseModel):
    sessionId: str
    nodes: list[str] = []


@router.post("/selection", response_model=AssistantAck)
def set_selection(body: Selection):
    """Tell the assistant what the user has selected on the canvas."""
    chat_service.manager.set_selection(body.sessionId, body.nodes)
    return {"ok": True}


# --------------------------------------------------------- provider settings
class UpdateProviderSettings(BaseModel):
    apiKey: str | None = None
    model: str | None = None
    baseUrl: str | None = None


def _require_model_selectable(provider_id: str) -> None:
    if provider_id not in _MODEL_SELECTABLE_PROVIDERS:
        raise HTTPException(404, f"{provider_id!r} has no settings to configure")


@router.get("/providers/{provider_id}/settings", response_model=AssistantProviderSettings)
def get_provider_settings(provider_id: str):
    _require_model_selectable(provider_id)
    current = settings_service.get(provider_id)
    return {
        "hasApiKey": bool(current.get("apiKey")),
        "model": current.get("model", ""),
        "baseUrl": current.get("baseUrl", ""),
        "envLocked": settings_service.env_locked(provider_id),
    }


@router.put("/providers/{provider_id}/settings", response_model=AssistantProviderSettings)
def put_provider_settings(provider_id: str, body: UpdateProviderSettings):
    _require_model_selectable(provider_id)
    if provider_id not in _CONFIGURABLE_PROVIDERS and (body.apiKey is not None or body.baseUrl is not None):
        raise HTTPException(400, f"{provider_id!r} has no API key or base URL to configure")
    values: dict[str, str] = {}
    if body.apiKey is not None:
        values["apiKey"] = body.apiKey.strip()
    if body.model is not None:
        values["model"] = body.model.strip()
    if body.baseUrl is not None:
        values["baseUrl"] = body.baseUrl.strip()
    current = settings_service.set(provider_id, values)
    return {
        "hasApiKey": bool(current.get("apiKey")),
        "model": current.get("model", ""),
        "baseUrl": current.get("baseUrl", ""),
        "envLocked": settings_service.env_locked(provider_id),
    }


@router.delete("/providers/{provider_id}/settings", response_model=AssistantAck)
def delete_provider_settings(provider_id: str):
    _require_model_selectable(provider_id)
    settings_service.clear(provider_id)
    return {"ok": True}


@router.get("/providers/{provider_id}/models", response_model=AssistantModelList)
def list_provider_models(provider_id: str):
    """Models the provider advertises, for the settings picker.

    Best-effort: an unset key or an unreachable endpoint just yields an empty
    list, and the dialog falls back to a free-form model field.
    """
    _require_model_selectable(provider_id)
    try:
        return {"models": list_models(provider_id)}
    except Exception as exc:  # noqa: BLE001 — any SDK/network failure degrades to no list
        logging.getLogger(__name__).info("could not list %s models: %s", provider_id, exc)
        return {"models": []}


# ------------------------------------------------------------------ proposals
@router.get("/proposals", response_model=AssistantProposalList)
def list_proposals(session_id: str = Query(alias="sessionId")):
    return {"proposals": [p.as_dict() for p in proposals.store.for_session(session_id)]}


@router.post("/proposals/{proposal_id}/apply", response_model=AssistantProposalResult)
async def apply_proposal(proposal_id: str):
    """Apply an approved proposal — the assistant's only path to a write."""
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
        chat_service.manager.notify_proposal_update(proposal)
        raise HTTPException(409, "the topology changed since this was proposed; ask for an updated proposal")

    if proposal.kind == "action":
        await _run_action(proposal)
        proposal.status = "applied"
        chat_service.manager.notify_proposal_update(proposal)
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
    chat_service.manager.notify_proposal_update(proposal)
    hub.publish({"type": "files"})
    return {"ok": True, "proposal": proposal.as_dict(), "revision": result.revision}


@router.post("/proposals/{proposal_id}/reject", response_model=AssistantProposalResult)
def reject_proposal(proposal_id: str):
    proposal = _require_proposal(proposal_id)
    if proposal.status == "pending":
        proposal.status = "rejected"
        chat_service.manager.notify_proposal_update(proposal)
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
    container = (nodes.get(node) or {}).get("container") if isinstance(nodes, dict) else None
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


async def shutdown() -> None:
    """Stop in-flight turns on app shutdown (called from the lifespan)."""
    with contextlib.suppress(Exception):
        await chat_service.manager.shutdown()
