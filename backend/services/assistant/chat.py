"""Chat sessions: one conversation with one agent, per open topology.

The provider owns the real transcript (it lives inside the agent CLI); this
manager owns the *plumbing* — one turn at a time, a :class:`services.events.Hub`
per chat so the browser can subscribe over SSE, and the bridge that turns
provider events into wire frames.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import stat
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from services import events
from services.assistant import prompts, proposals
from services.assistant.config import (
    MAX_CONCURRENT_CHATS,
    MCP_SERVER_NAME,
    mcp_base_url,
    mcp_token,
)
from services.assistant.providers import create as create_provider
from services.assistant.providers.base import AgentProvider, SessionSpec

logger = logging.getLogger(__name__)


class ChatError(RuntimeError):
    """Expected failure with a message worth showing the user."""


@dataclass
class Chat:
    id: str
    provider_id: str
    session_id: str
    mode: str
    model: str
    # None for a chat just loaded from disk: the live process/session behind a
    # provider isn't something we persist or can restore, so it is (re)created
    # lazily in ``_start`` the next time the chat is sent to.
    provider: AgentProvider | None = None
    hub: events.Hub = field(default_factory=events.Hub)
    started: bool = False
    turn: asyncio.Task | None = None
    turn_seq: int = 0
    # Monotonic per-chat frame counter. Every frame carries its ``seq`` so an
    # SSE reconnect can replay history and then skip any live frame it already
    # saw, closing the gap between "fetch history" and "subscribe".
    seq: int = 0
    title: str = "New conversation"
    created_at: float = field(default_factory=time.time)
    # Replayed to a browser that opens the panel mid-conversation or reconnects.
    history: list[dict[str, Any]] = field(default_factory=list)

    @property
    def busy(self) -> bool:
        return self.turn is not None and not self.turn.done()

    def as_dict(self) -> dict[str, Any]:
        return {
            "chatId": self.id,
            "providerId": self.provider_id,
            "sessionId": self.session_id,
            "mode": self.mode,
            "model": self.model,
            "busy": self.busy,
            "title": self.title,
            "createdAt": self.created_at,
        }

    def to_persisted(self) -> dict[str, Any]:
        """Everything needed to restore this chat's transcript, but not its
        live provider process — that can't be serialized and isn't restored."""
        return {
            "id": self.id,
            "providerId": self.provider_id,
            "sessionId": self.session_id,
            "mode": self.mode,
            "model": self.model,
            "turnSeq": self.turn_seq,
            "seq": self.seq,
            "title": self.title,
            "createdAt": self.created_at,
            "history": self.history,
        }

    @classmethod
    def from_persisted(cls, data: dict[str, Any]) -> Chat:
        return cls(
            id=data["id"],
            provider_id=data["providerId"],
            session_id=data["sessionId"],
            mode=data.get("mode", "ask"),
            model=data.get("model", ""),
            turn_seq=data.get("turnSeq", 0),
            seq=data.get("seq", 0),
            title=data.get("title", "New conversation"),
            created_at=data.get("createdAt", time.time()),
            history=data.get("history", []),
        )


def _chats_dir() -> Path:
    raw = os.environ.get("NETLAB_APP_ASSISTANT_CHATS_DIR", "~/.netlab_gui_assistant_chats")
    return Path(raw).expanduser()


class AssistantChatManager:
    def __init__(self) -> None:
        self._chats: dict[str, Chat] = {}
        self._selection: dict[str, list[str]] = {}
        self._load_persisted()

    # ------------------------------------------------------------ persistence
    def _load_persisted(self) -> None:
        directory = _chats_dir()
        if not directory.is_dir():
            return
        for path in directory.glob("*.json"):
            try:
                chat = Chat.from_persisted(json.loads(path.read_text()))
            except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
                logger.warning("Failed to load persisted chat %s", path, exc_info=True)
                continue
            self._chats[chat.id] = chat

    def _persist(self, chat: Chat) -> None:
        try:
            directory = _chats_dir()
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / f"{chat.id}.json"
            path.write_text(json.dumps(chat.to_persisted(), indent=2))
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            logger.warning("Failed to persist chat %s", chat.id, exc_info=True)

    def _forget(self, chat_id: str) -> None:
        with contextlib.suppress(OSError):
            (_chats_dir() / f"{chat_id}.json").unlink(missing_ok=True)

    # ----------------------------------------------------------- lifecycle
    def create(self, provider_id: str, session_id: str, mode: str = "ask", model: str = "") -> Chat:
        live = [chat for chat in self._chats.values() if chat.busy]
        if len(live) >= MAX_CONCURRENT_CHATS:
            raise ChatError(f"too many active conversations (limit {MAX_CONCURRENT_CHATS})")
        try:
            provider = create_provider(provider_id)
        except KeyError:
            raise ChatError(f"unknown provider {provider_id!r}") from None
        except RuntimeError as exc:
            raise ChatError(str(exc)) from exc

        chat = Chat(
            id=uuid.uuid4().hex,
            provider_id=provider_id,
            session_id=session_id,
            mode=mode,
            model=model,
            provider=provider,
        )
        self._chats[chat.id] = chat
        self._persist(chat)
        return chat

    def chat_ids(self) -> list[str]:
        return list(self._chats)

    def for_session(self, session_id: str) -> list[Chat]:
        return sorted(
            (chat for chat in self._chats.values() if chat.session_id == session_id),
            key=lambda chat: chat.created_at,
            reverse=True,
        )

    def get(self, chat_id: str) -> Chat:
        chat = self._chats.get(chat_id)
        if chat is None:
            raise ChatError("unknown chat")
        return chat

    async def delete(self, chat_id: str) -> None:
        chat = self._chats.pop(chat_id, None)
        if chat is None:
            return
        await self._stop_turn(chat)
        if chat.provider is not None:
            with contextlib.suppress(Exception):
                await chat.provider.close()
        self._forget(chat_id)

    async def shutdown(self) -> None:
        """Stop live turns and close provider processes, but keep chat history
        on disk — unlike :meth:`delete`, this isn't the user discarding a chat,
        just the backend restarting."""
        for chat in list(self._chats.values()):
            await self._stop_turn(chat)
            if chat.provider is not None:
                with contextlib.suppress(Exception):
                    await chat.provider.close()
        self._chats.clear()

    async def switch_provider(self, chat_id: str, provider_id: str, model: str) -> Chat:
        """Point an existing chat at a different provider/model, keeping its
        transcript. The old provider's live process/session is gone regardless
        — vendor conversation state doesn't transfer between providers — so
        this is "same visible thread, fresh backend", not context continuity."""
        chat = self.get(chat_id)
        if chat.busy:
            raise ChatError("the assistant is still working on the previous message")
        if chat.provider_id == provider_id and chat.model == model:
            return chat
        try:
            create_provider(provider_id)
        except KeyError:
            raise ChatError(f"unknown provider {provider_id!r}") from None
        except RuntimeError as exc:
            raise ChatError(str(exc)) from exc

        if chat.provider is not None:
            with contextlib.suppress(Exception):
                await chat.provider.close()
        chat.provider = None
        chat.provider_id = provider_id
        chat.model = model
        chat.started = False
        self._persist(chat)
        return chat

    # --------------------------------------------------------------- turns
    async def send(self, chat_id: str, text: str, selection: list[str] | None = None) -> None:
        chat = self.get(chat_id)
        if chat.busy:
            raise ChatError("the assistant is still working on the previous message")
        if selection is not None:
            self._selection[chat.session_id] = selection

        if not chat.history:
            chat.title = _chat_title(text)
        # User turns are part of replay/history, but are not published to the
        # live subscriber because the composer already adds them optimistically.
        chat.seq += 1
        chat.history.append(
            {
                "type": "user_message",
                "messageId": f"u{chat.turn_seq + 1}",
                "text": text,
                "createdAt": time.time(),
                "seq": chat.seq,
            }
        )

        self._persist(chat)

        if not chat.started:
            await self._start(chat)
        prompt = self._compose(chat, text, selection)
        chat.turn_seq += 1
        chat.turn = asyncio.create_task(self._run_turn(chat, prompt, f"t{chat.turn_seq}"))

    async def cancel(self, chat_id: str) -> None:
        await self._stop_turn(self.get(chat_id))

    async def _start(self, chat: Chat) -> None:
        from app.sessions.store import store

        if chat.provider is None:
            # A chat restored from disk after a backend restart has no live
            # provider process — the vendor/CLI conversation state it held is
            # gone regardless, so a fresh one is what continuing this chat means.
            try:
                chat.provider = create_provider(chat.provider_id)
            except KeyError:
                raise ChatError(f"unknown provider {chat.provider_id!r}") from None
            except RuntimeError as exc:
                raise ChatError(str(exc)) from exc

        session = store.get(chat.session_id)
        cwd = str(Path(session.topology_path).parent) if session else str(Path.cwd())
        spec = SessionSpec(
            system_prompt=prompts.system_prompt(chat.mode),
            mcp_url=mcp_base_url(),
            mcp_token=mcp_token(),
            cwd=cwd,
        )
        try:
            await chat.provider.start(spec)
        except Exception as exc:
            raise ChatError(f"could not start {chat.provider_id}: {exc}") from exc
        chat.started = True

    def _compose(self, chat: Chat, text: str, selection: list[str] | None) -> str:
        """Prefix the user's message with the context the agent can't see."""
        lines = [f"[netlab-ui context] sessionId={chat.session_id}"]
        if selection:
            lines.append(f"selected on canvas: {', '.join(selection)}")
        lines.append("")
        lines.append(text)
        return "\n".join(lines)

    async def _run_turn(self, chat: Chat, prompt: str, turn_id: str) -> None:
        assert chat.provider is not None, "_start must run before a turn"
        self._emit(chat, {"type": "turn_started", "turnId": turn_id})
        try:
            async for event in chat.provider.send(prompt):
                frame = {"type": event.type, "turnId": turn_id, **event.data}
                self._emit(chat, frame)
            # Providers that end without an explicit result still need to
            # release the composer in the UI.
            if not self._last_is_done(chat, turn_id):
                self._emit(chat, {"type": "turn_done", "turnId": turn_id, "stopReason": "end_turn"})
        except asyncio.CancelledError:
            self._emit(chat, {"type": "turn_done", "turnId": turn_id, "stopReason": "cancelled"})
            raise
        except Exception as exc:
            logger.exception("assistant turn failed")
            self._emit(chat, {"type": "error", "turnId": turn_id, "message": str(exc)})
            self._emit(chat, {"type": "turn_done", "turnId": turn_id, "stopReason": "error"})
        finally:
            self._persist(chat)

    def _last_is_done(self, chat: Chat, turn_id: str) -> bool:
        for frame in reversed(chat.history):
            if frame.get("turnId") == turn_id:
                return frame.get("type") == "turn_done"
        return False

    async def _stop_turn(self, chat: Chat) -> None:
        if not chat.busy or chat.turn is None:
            return
        with contextlib.suppress(Exception):
            await chat.provider.cancel()
        chat.turn.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await chat.turn

    # -------------------------------------------------------------- events
    def _emit(self, chat: Chat, frame: dict[str, Any]) -> None:
        chat.seq += 1
        frame["seq"] = chat.seq
        chat.history.append(frame)
        chat.hub.publish(frame)

    def notify_proposal(self, session_id: str, proposal: proposals.Proposal) -> None:
        """A tool staged a change: show it in every chat on this topology."""
        frame = {"type": "proposal", "proposal": proposal.as_dict()}
        for chat in self._chats.values():
            if chat.session_id == session_id:
                self._emit(chat, frame)
                self._persist(chat)

    def notify_proposal_update(self, proposal: proposals.Proposal) -> None:
        frame = {
            "type": "proposal_update",
            "proposalId": proposal.id,
            "status": proposal.status,
        }
        for chat in self._chats.values():
            if chat.session_id == proposal.session_id:
                self._emit(chat, frame)
                self._persist(chat)

    # ------------------------------------------------------------ selection
    def set_selection(self, session_id: str, nodes: list[str]) -> None:
        self._selection[session_id] = nodes

    def selection_for(self, session_id: str) -> list[str]:
        return self._selection.get(session_id, [])


manager = AssistantChatManager()


def _chat_title(text: str) -> str:
    first_line = " ".join(text.strip().splitlines()[0:1])
    compact = " ".join(first_line.split())
    if len(compact) <= 56:
        return compact or "New conversation"
    return f"{compact[:53].rstrip()}..."


__all__ = ["MCP_SERVER_NAME", "Chat", "ChatError", "manager"]
