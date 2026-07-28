"""Chat plumbing: turns, the SSE frame contract, and cancellation.

Driven by a scripted provider, so no agent CLI is involved and the test is
about the wiring rather than any model's behaviour.
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

pytest.importorskip("mcp")
from fastapi.testclient import TestClient

from app.assistant import router
from app.main import app
from app.sessions.store import store
from services.assistant import chat as chat_service
from services.assistant import proposals, providers
from services.assistant.providers.base import AgentEvent, ProviderInfo
from services.assistant.providers.fake import FakeProvider


@pytest.fixture
def session(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text("name: demo\nnodes:\n  r1:\n    device: frr\n")
    created = store.create(str(path))
    yield created
    store.delete(created.id)
    proposals.store.clear()


@pytest.fixture
def scripted(monkeypatch):
    """Register a provider whose script the test controls."""
    holder: dict[str, FakeProvider] = {}

    def factory():
        provider = FakeProvider(holder.get("script"))
        holder["provider"] = provider
        return provider

    providers.register("scripted", lambda: ProviderInfo(id="scripted", name="Scripted", available=True), factory)
    return holder


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
        # Tear chats down through the app so provider cleanup runs on the
        # client's event loop rather than a fresh (already closed) one.
        for chat_id in list(chat_service.manager.chat_ids()):
            test_client.delete(f"/api/assistant/chats/{chat_id}")


def _events(client, chat_id, expect_type):
    """Read the SSE stream until ``expect_type`` arrives."""
    frames = []
    with client.stream("GET", f"/api/assistant/chats/{chat_id}/events") as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            frame = json.loads(line[6:])
            frames.append(frame)
            if frame["type"] == expect_type:
                break
    return frames


def _wait_for_turn(client, chat_id, timeout=5.0):
    """Read history once the background turn has finished.

    ``POST /messages`` answers 202 as soon as the turn task is created, so
    anything that looks at the turn's output — history frames, provider state —
    has to wait for ``turn_done`` first instead of assuming the task already ran.
    """
    deadline = time.monotonic() + timeout
    while True:
        frames = client.get(f"/api/assistant/chats/{chat_id}").json()["events"]
        if any(frame["type"] == "turn_done" for frame in frames):
            return frames
        assert time.monotonic() < deadline, "turn did not finish"
        time.sleep(0.01)


def test_capabilities_lists_providers_and_mcp(client):
    body = client.get("/api/assistant/capabilities").json()
    assert body["enabled"] is True
    assert body["mcp"]["url"].endswith("/mcp")
    assert body["mcp"]["authHeader"].startswith("Bearer ")
    assert "propose_topology_edit" in body["mcp"]["tools"]


def test_chat_requires_a_known_session(client, scripted):
    response = client.post("/api/assistant/chats", json={"providerId": "scripted", "sessionId": "nope"})
    assert response.status_code == 404


def test_turn_streams_frames_in_order(client, scripted, session):
    scripted["script"] = [
        AgentEvent("tool_call", {"toolUseId": "u1", "tool": "get_topology_yaml", "args": {}}),
        AgentEvent("tool_result", {"toolUseId": "u1", "ok": True, "preview": "name: demo"}),
        AgentEvent("text_delta", {"text": "Two "}),
        AgentEvent("text_delta", {"text": "routers."}),
        AgentEvent("turn_done", {"stopReason": "end_turn"}),
    ]
    chat_id = client.post("/api/assistant/chats", json={"providerId": "scripted", "sessionId": session.id}).json()[
        "chatId"
    ]

    assert (
        client.post(f"/api/assistant/chats/{chat_id}/messages", json={"text": "what is this lab?"}).status_code == 202
    )

    frames = _wait_for_turn(client, chat_id)
    types = [frame["type"] for frame in frames]
    assert types == [
        "user_message",
        "turn_started",
        "tool_call",
        "tool_result",
        "text_delta",
        "text_delta",
        "turn_done",
    ]
    assert frames[0]["text"] == "what is this lab?"
    assert "".join(f["text"] for f in frames if f["type"] == "text_delta") == "Two routers."
    assert all(frame["turnId"] == "t1" for frame in frames[1:])

    chats = client.get("/api/assistant/chats", params={"sessionId": session.id}).json()["chats"]
    assert chats[0]["chatId"] == chat_id
    assert chats[0]["title"] == "what is this lab?"


def test_context_is_prefixed_to_the_prompt(client, scripted, session):
    chat_id = client.post("/api/assistant/chats", json={"providerId": "scripted", "sessionId": session.id}).json()[
        "chatId"
    ]
    client.post(
        f"/api/assistant/chats/{chat_id}/messages",
        json={"text": "explain the selection", "selection": ["r1"]},
    )
    _wait_for_turn(client, chat_id)
    # The agent learns the session id and canvas selection without the user
    # having to type them.
    prompt = scripted["provider"].last_prompt
    assert session.id in prompt
    assert "r1" in prompt
    assert "explain the selection" in prompt
    assert chat_service.manager.selection_for(session.id) == ["r1"]


def test_provider_failure_surfaces_as_an_error_frame(client, scripted, session):
    class Boom(FakeProvider):
        async def send(self, prompt):  # noqa: ARG002
            raise RuntimeError("claude CLI not logged in")
            yield  # pragma: no cover - makes this an async generator

    providers.register("boom", lambda: ProviderInfo(id="boom", name="Boom", available=True), lambda: Boom())
    chat_id = client.post("/api/assistant/chats", json={"providerId": "boom", "sessionId": session.id}).json()["chatId"]
    client.post(f"/api/assistant/chats/{chat_id}/messages", json={"text": "hi"})

    frames = _wait_for_turn(client, chat_id)
    error = next(frame for frame in frames if frame["type"] == "error")
    assert "not logged in" in error["message"]
    assert frames[-1]["type"] == "turn_done"


def test_unavailable_provider_is_refused(client, session):
    providers.register(
        "missing",
        lambda: ProviderInfo(id="missing", name="Missing", available=False, note="install it first"),
        lambda: None,
    )
    response = client.post("/api/assistant/chats", json={"providerId": "missing", "sessionId": session.id})
    assert response.status_code == 400
    assert "install it first" in response.json()["detail"]


def test_proposal_reaches_the_chat_stream(client, scripted, session):
    chat_id = client.post("/api/assistant/chats", json={"providerId": "scripted", "sessionId": session.id}).json()[
        "chatId"
    ]
    proposal = proposals.create_edit(
        session_id=session.id,
        topology_path=session.topology_path,
        base_revision=session.revision,
        commands_list=[{"type": "addNode", "id": "r2", "device": "frr"}],
        rationale="second router",
    )
    chat_service.manager.notify_proposal(session.id, proposal)

    frames = client.get(f"/api/assistant/chats/{chat_id}").json()["events"]
    pushed = next(frame for frame in frames if frame["type"] == "proposal")
    assert pushed["proposal"]["id"] == proposal.id
    assert "+  r2:" in pushed["proposal"]["diff"]

    client.post(f"/api/assistant/proposals/{proposal.id}/apply")
    updated = client.get(f"/api/assistant/chats/{chat_id}").json()["events"]
    last = updated[-1]
    assert last["type"] == "proposal_update"
    assert last["proposalId"] == proposal.id
    assert last["status"] == "applied"


def test_sse_frames_are_wire_formatted(scripted, session):
    """The stream the panel consumes: one `data: {json}` frame per event."""

    async def run() -> list[str]:
        chat = chat_service.manager.create("scripted", session.id)
        stream = router.sse_frames(chat)
        try:
            # Give the generator a turn to subscribe before publishing.
            first = asyncio.ensure_future(anext(stream))
            await asyncio.sleep(0)
            chat.hub.publish({"type": "text_delta", "turnId": "t1", "text": "hi"})
            return [await first]
        finally:
            await stream.aclose()
            await chat_service.manager.delete(chat.id)

    frames = asyncio.run(run())
    assert frames == ['data: {"type": "text_delta", "turnId": "t1", "text": "hi"}\n\n']


def test_replay_streams_history_then_live_without_duplicates(scripted, session):
    """`?replay=1` replays history, then continues live, skipping seen frames."""

    async def run() -> list[dict]:
        chat = chat_service.manager.create("scripted", session.id)
        # Two frames already in history, each carrying a monotonic seq.
        chat_service.manager._emit(chat, {"type": "text_delta", "turnId": "t1", "text": "a"})
        chat_service.manager._emit(chat, {"type": "text_delta", "turnId": "t1", "text": "b"})

        stream = router.sse_frames(chat, replay=True)
        collected: list[dict] = []
        try:
            # The two history frames are replayed first.
            collected.append(json.loads((await anext(stream)).removeprefix("data: ")))
            collected.append(json.loads((await anext(stream)).removeprefix("data: ")))

            live = asyncio.ensure_future(anext(stream))
            await asyncio.sleep(0)
            # A stale duplicate (seq already replayed) is dropped; the next new
            # frame comes through.
            chat.hub.publish({"type": "text_delta", "turnId": "t1", "text": "b", "seq": 2})
            chat_service.manager._emit(chat, {"type": "text_delta", "turnId": "t1", "text": "c"})
            collected.append(json.loads((await live).removeprefix("data: ")))
            return collected
        finally:
            await stream.aclose()
            await chat_service.manager.delete(chat.id)

    frames = asyncio.run(run())
    assert [f["text"] for f in frames] == ["a", "b", "c"]
    assert [f["seq"] for f in frames] == [1, 2, 3]


def test_subscribers_receive_turn_frames_live(scripted, session):
    """What the SSE endpoint forwards: every frame of a turn, in order."""
    scripted["script"] = [
        AgentEvent("text_delta", {"text": "hello"}),
        AgentEvent("turn_done", {"stopReason": "end_turn"}),
    ]

    async def run() -> list[dict]:
        chat = chat_service.manager.create("scripted", session.id)
        queue = chat.hub.subscribe()
        try:
            await chat_service.manager.send(chat.id, "hi")
            await chat.turn
            return [queue.get_nowait() for _ in range(queue.qsize())]
        finally:
            chat.hub.unsubscribe(queue)
            await chat_service.manager.delete(chat.id)

    frames = asyncio.run(run())
    assert [frame["type"] for frame in frames] == ["turn_started", "text_delta", "turn_done"]
    assert frames[1]["text"] == "hello"


def test_unknown_chat_is_404(client):
    assert client.get("/api/assistant/chats/nope").status_code == 404
    assert client.post("/api/assistant/chats/nope/messages", json={"text": "hi"}).status_code == 400


def test_switch_provider_keeps_history_and_updates_provider(client, scripted, session):
    providers.register(
        "scripted2", lambda: ProviderInfo(id="scripted2", name="Scripted 2", available=True), lambda: FakeProvider()
    )
    scripted["script"] = [AgentEvent("text_delta", {"text": "hi"}), AgentEvent("turn_done", {"stopReason": "end_turn"})]
    chat_id = client.post(
        "/api/assistant/chats", json={"providerId": "scripted", "sessionId": session.id, "model": "m1"}
    ).json()["chatId"]
    assert client.post(f"/api/assistant/chats/{chat_id}/messages", json={"text": "hi"}).status_code == 202
    # Switching providers is refused while a turn is in flight.
    _wait_for_turn(client, chat_id)

    response = client.post(f"/api/assistant/chats/{chat_id}/provider", json={"providerId": "scripted2", "model": "m2"})
    assert response.status_code == 200
    body = response.json()
    assert body["providerId"] == "scripted2"
    assert body["model"] == "m2"

    history = client.get(f"/api/assistant/chats/{chat_id}").json()
    assert history["chat"]["providerId"] == "scripted2"
    assert any(frame["type"] == "user_message" for frame in history["events"])


def test_switch_provider_rejects_unknown_provider(client, scripted, session):
    chat_id = client.post("/api/assistant/chats", json={"providerId": "scripted", "sessionId": session.id}).json()[
        "chatId"
    ]
    response = client.post(f"/api/assistant/chats/{chat_id}/provider", json={"providerId": "nope"})
    assert response.status_code == 400


def test_switch_provider_refused_while_busy(client, monkeypatch, session):
    async def raise_busy(*_args, **_kwargs):
        raise chat_service.ChatError("the assistant is still working on the previous message")

    monkeypatch.setattr(chat_service.manager, "switch_provider", raise_busy)
    response = client.post("/api/assistant/chats/whatever/provider", json={"providerId": "scripted"})
    assert response.status_code == 409
