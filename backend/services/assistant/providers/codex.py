"""Codex CLI adapter.

Drives the user's locally installed, already-logged-in ``codex`` CLI in
non-interactive mode (``codex exec --json``). Like :mod:`.claude`, Codex
authenticates itself (ChatGPT sign-in or an API key set via ``codex login``) —
netlab-ui never sees a credential. Codex speaks MCP as a client, so we point it
at our own MCP endpoint over streamable HTTP and let it drive the tool loop,
exactly as Claude Code does.

Two differences from Claude drive the shape of this file:

* ``codex exec`` is one-shot per invocation, so multi-turn context is kept by
  capturing the ``thread_id`` from the first run and ``codex exec resume``-ing it
  on later turns.
* There is no Python SDK; we spawn the CLI and parse its ``--json`` event stream
  (the thread-event schema: ``thread.started`` / ``turn.*`` / ``item.*``). Every
  codex-specific detail (flags, event names) is confined to this file.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any, ClassVar

from services.assistant.config import MCP_SERVER_NAME, codex_model
from services.assistant.providers.base import AgentEvent, ProviderInfo, SessionSpec, probe_cli

logger = logging.getLogger(__name__)

# Name of the env var we set on the codex subprocess for it to read the MCP
# bearer token from — codex references it by name via ``bearer_token_env_var``
# rather than taking the secret on the command line.
_BEARER_ENV = "NETLAB_APP_ASSISTANT_MCP_BEARER"


def detect() -> ProviderInfo:
    version = probe_cli("codex")
    if version is None:
        return ProviderInfo(
            id="codex",
            name="Codex",
            available=False,
            note="codex CLI not found on PATH — install Codex and run `codex login` once to sign in",
        )
    return ProviderInfo(
        id="codex",
        name="Codex",
        available=True,
        version=version,
        takes_model=True,
        api_key_url="https://platform.openai.com/",
    )




class CodexProvider:
    provider_id: ClassVar[str] = "codex"

    def __init__(self) -> None:
        self._spec: SessionSpec | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._thread_id: str | None = None
        self._cancelled = False

    async def start(self, spec: SessionSpec) -> None:
        # ``codex exec`` is spawned per turn; nothing to launch up front.
        self._spec = spec

    async def send(self, prompt: str) -> AsyncIterator[AgentEvent]:
        if self._spec is None:
            raise RuntimeError("provider not started")
        self._cancelled = False

        args = self._build_args(prompt)
        env = {**os.environ, _BEARER_ENV: self._spec.mcp_token}
        self._proc = await asyncio.create_subprocess_exec(
            "codex",
            *args,
            cwd=self._spec.cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert self._proc.stdout is not None

        # Drain stderr concurrently so a chatty CLI can't deadlock us by filling
        # its stderr pipe while we're blocked reading stdout.
        stderr_task = asyncio.create_task(_read_all(self._proc.stderr))

        saw_done = False
        async for raw_line in self._proc.stdout:
            if self._cancelled:
                break
            line = raw_line.decode(errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                # ``--json`` is a pure event stream, but tolerate any stray
                # non-JSON line rather than aborting the turn on it.
                continue
            if event.get("type") == "thread.started" and event.get("thread_id"):
                self._thread_id = str(event["thread_id"])
            for agent_event in _translate(event):
                if agent_event.type == "turn_done":
                    saw_done = True
                yield agent_event

        await self._proc.wait()
        stderr = await stderr_task

        if self._cancelled:
            return
        if not saw_done:
            # The process ended without a turn.completed/failed — surface why.
            if self._proc.returncode and stderr.strip():
                yield AgentEvent("error", {"message": _first_lines(stderr)})
            yield AgentEvent("turn_done", {"stopReason": "error" if self._proc.returncode else "end_turn"})

    def _build_args(self, prompt: str) -> list[str]:
        spec = self._spec
        assert spec is not None
        # Point codex at our MCP endpoint and keep it non-interactive and
        # read-only: our MCP tools are the intended action surface and every
        # mutation lands in the proposal store for the user to approve, so the
        # built-in shell never needs write/approval. Injected via `-c` overrides
        # (rather than the `--sandbox`/`--url` flags) because those apply
        # identically to `exec` and `exec resume`.
        common = [
            "--json",
            "--skip-git-repo-check",
            "-c",
            'approval_policy="never"',
            "-c",
            'sandbox_mode="read-only"',
            "-c",
            f'mcp_servers.{MCP_SERVER_NAME}.url="{spec.mcp_url}"',
            "-c",
            f'mcp_servers.{MCP_SERVER_NAME}.bearer_token_env_var="{_BEARER_ENV}"',
        ]
        model = codex_model()
        if model:
            escaped = model.replace("\\", "\\\\").replace('"', '\\"')
            common += ["-c", f'model="{escaped}"']
        if self._thread_id:
            # Resume keeps the conversation (and the system prompt from turn one).
            return ["exec", "resume", self._thread_id, *common, prompt]
        first_prompt = f"{spec.system_prompt}\n\n{prompt}" if spec.system_prompt else prompt
        return ["exec", *common, first_prompt]

    async def cancel(self) -> None:
        self._cancelled = True
        proc = self._proc
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()

    async def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), timeout=5.0)


async def _read_all(stream: asyncio.StreamReader | None) -> str:
    if stream is None:
        return ""
    data = await stream.read()
    return data.decode(errors="replace")


def _first_lines(text: str, limit: int = 3) -> str:
    lines = [line for line in text.splitlines() if line.strip()]
    return " / ".join(lines[-limit:])[:500] if lines else "codex exited without output"


def _translate(event: dict[str, Any]) -> list[AgentEvent]:
    """Map one codex ``--json`` thread event onto zero or more UI events."""
    etype = event.get("type")

    if etype in {"item.started", "item.updated", "item.completed"}:
        return _translate_item(etype, event.get("item") or {})
    if etype == "turn.completed":
        return [AgentEvent("turn_done", {"stopReason": "end_turn", "costUsd": None, "durationMs": None})]
    if etype == "turn.failed":
        message = (event.get("error") or {}).get("message") or "codex turn failed"
        return [AgentEvent("error", {"message": message}), AgentEvent("turn_done", {"stopReason": "error"})]
    if etype == "error":
        return [AgentEvent("error", {"message": event.get("message") or "codex error"})]
    return []


def _translate_item(etype: str, item: dict[str, Any]) -> list[AgentEvent]:
    itype = item.get("type")
    item_id = str(item.get("id") or "")

    if itype == "agent_message":
        # The assistant text arrives whole on completion (exec --json does not
        # emit token deltas), so emit it once rather than on every update.
        if etype == "item.completed" and item.get("text"):
            return [AgentEvent("text_delta", {"text": item["text"]})]
        return []

    if itype == "reasoning":
        return [AgentEvent("thinking", {})] if etype == "item.started" else []

    if itype == "mcp_tool_call":
        if etype == "item.started":
            return [
                AgentEvent(
                    "tool_call",
                    {
                        "toolUseId": item_id,
                        "tool": _short_name(item.get("tool") or ""),
                        "args": _as_dict(item.get("arguments")),
                    },
                )
            ]
        if etype == "item.completed":
            return [
                AgentEvent(
                    "tool_result",
                    {"toolUseId": item_id, "ok": item.get("status") == "completed", "preview": _tool_preview(item)},
                )
            ]
        return []

    if itype == "command_execution":
        # A local shell command codex ran itself (read-only). Surface it so it
        # is visible in the transcript alongside the MCP tool calls.
        if etype == "item.started":
            return [
                AgentEvent(
                    "tool_call", {"toolUseId": item_id, "tool": "shell", "args": {"command": item.get("command") or ""}}
                )
            ]
        if etype == "item.completed":
            return [
                AgentEvent(
                    "tool_result",
                    {
                        "toolUseId": item_id,
                        "ok": item.get("status") == "completed",
                        "preview": _clip(item.get("aggregated_output") or ""),
                    },
                )
            ]
        return []

    if itype == "error" and etype == "item.completed":
        return [AgentEvent("error", {"message": item.get("message") or "codex item error"})]

    return []


def _short_name(name: str) -> str:
    """Strip the MCP prefix codex may prepend, matching the Claude adapter."""
    for prefix in (f"mcp__{MCP_SERVER_NAME}__", f"{MCP_SERVER_NAME}__", f"{MCP_SERVER_NAME}."):
        if name.startswith(prefix):
            return name[len(prefix) :]
    return name


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        with contextlib.suppress(json.JSONDecodeError):
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
    return {}


def _tool_preview(item: dict[str, Any], limit: int = 200) -> str:
    error = item.get("error")
    if isinstance(error, dict) and error.get("message"):
        return _clip(str(error["message"]), limit)
    result = item.get("result")
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list):
        text = " ".join(
            block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"
        )
        return _clip(text, limit)
    return ""


def _clip(text: str, limit: int = 200) -> str:
    text = str(text or "").strip().replace("\n", " ")
    return text[:limit] + ("…" if len(text) > limit else "")
