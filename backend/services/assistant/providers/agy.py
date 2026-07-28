"""Google Antigravity CLI adapter.

Drives the user's locally installed, already-logged-in ``agy`` CLI in
non-interactive mode (``agy --output-format json``). Like Codex and Claude Code,
agy authenticates itself (Gemini sign-in or an API key) — netlab-ui never
sees a credential. agy speaks MCP as a client, so we register our MCP server
temporarily in the project's ``.agents/mcp_config.json`` configuration file
during the session.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import subprocess
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, ClassVar

from services.assistant.config import MCP_SERVER_NAME, agy_model
from services.assistant.providers.base import AgentEvent, ProviderInfo, SessionSpec, probe_cli

logger = logging.getLogger(__name__)


def detect() -> ProviderInfo:
    version = probe_cli("agy")
    if version is None:
        return ProviderInfo(
            id="agy",
            name="Antigravity CLI",
            available=False,
            note="agy CLI not found on PATH — install google-antigravity-cli",
        )
    return ProviderInfo(id="agy", name="Antigravity CLI", available=True, version=version, takes_model=True)


def list_models() -> list[str]:
    """``agy models`` prints one model name per line — the only one of the CLI
    agents (Claude Code, Codex, agy) that can enumerate its own models."""
    try:
        result = subprocess.run(
            ["agy", "models"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


class AgyProvider:
    provider_id: ClassVar[str] = "agy"

    def __init__(self) -> None:
        self._spec: SessionSpec | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._conversation_id: str | None = None
        self._cancelled = False
        self._config_path: Path | None = None
        # Unique per session, so two agy sessions in the same lab directory
        # (same .agents/mcp_config.json) each own a distinct key instead of
        # racing to overwrite one shared MCP_SERVER_NAME entry.
        self._server_key = f"{MCP_SERVER_NAME}-{uuid.uuid4().hex[:8]}"

    async def start(self, spec: SessionSpec) -> None:
        self._spec = spec

        # Register our MCP server in .agents/mcp_config.json in the workspace.
        # Only our own uniquely-keyed entry is ever added/removed (see close()),
        # so a concurrent session touching the same file can't lose its entry
        # or have its live registration overwritten by ours.
        try:
            agents_dir = Path(spec.cwd) / ".agents"
            agents_dir.mkdir(parents=True, exist_ok=True)
            self._config_path = agents_dir / "mcp_config.json"

            config_data: dict[str, Any] = {"mcpServers": {}}
            if self._config_path.exists():
                try:
                    with open(self._config_path, encoding="utf-8") as f:
                        config_data = json.load(f)
                except (OSError, TypeError, ValueError) as e:
                    logger.warning("Failed to read existing mcp_config.json: %s", e)

            mcp_servers = config_data.setdefault("mcpServers", {})
            mcp_servers[self._server_key] = {
                "url": spec.mcp_url,
                "headers": {"Authorization": f"Bearer {spec.mcp_token}"},
            }

            with open(self._config_path, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2)

            logger.info("Successfully registered MCP server in %s", self._config_path)
        except (AttributeError, OSError, TypeError, ValueError) as e:
            logger.error("Failed to write .agents/mcp_config.json: %s", e)

    async def send(self, prompt: str) -> AsyncIterator[AgentEvent]:
        if self._spec is None:
            raise RuntimeError("provider not started")
        self._cancelled = False

        # Yield a thinking event so the UI displays the reasoning state while agy runs
        yield AgentEvent("thinking", {})

        args = self._build_args(prompt)
        self._proc = await asyncio.create_subprocess_exec(
            "agy",
            *args,
            cwd=self._spec.cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout_bytes, stderr_bytes = await self._proc.communicate()
        except asyncio.CancelledError:
            self._cancelled = True
            await self.cancel()
            raise

        if self._cancelled:
            return

        stdout = stdout_bytes.decode(errors="replace").strip()
        stderr_bytes.decode(errors="replace").strip()

        # Parse JSON output
        event = {}
        if stdout:
            try:
                event = json.loads(stdout)
            except json.JSONDecodeError:
                logger.warning("Failed to parse agy output as JSON: %s", stdout)

        if event.get("conversation_id"):
            self._conversation_id = str(event["conversation_id"])

        status = event.get("status")
        error_msg = event.get("error")
        response_text = event.get("response")

        if status == "ERROR" or error_msg:
            msg = error_msg or "agy execution failed"
            yield AgentEvent("error", {"message": msg})
            yield AgentEvent("turn_done", {"stopReason": "error"})
        else:
            if response_text:
                yield AgentEvent("text_delta", {"text": response_text})
            yield AgentEvent("turn_done", {"stopReason": "end_turn"})

    def _build_args(self, prompt: str) -> list[str]:
        spec = self._spec
        assert spec is not None

        common = [
            "--dangerously-skip-permissions",
            "--output-format",
            "json",
        ]

        if self._conversation_id:
            return ["--conversation", self._conversation_id, *common, "--print", prompt]

        model = agy_model()
        if model:
            common = ["--model", model, *common]
        first_prompt = f"{spec.system_prompt}\n\n{prompt}" if spec.system_prompt else prompt
        return [*common, "--print", first_prompt]

    async def cancel(self) -> None:
        self._cancelled = True
        proc = self._proc
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()

    async def close(self) -> None:
        # Terminate process if still running
        proc, self._proc = self._proc, None
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), timeout=5.0)

        # Remove only our own entry from mcp_config.json, re-reading it fresh so a
        # concurrent session's own add/remove in the meantime isn't clobbered.
        if self._config_path and self._config_path.exists():
            try:
                with open(self._config_path, encoding="utf-8") as f:
                    config_data = json.load(f)
                mcp_servers = config_data.get("mcpServers")
                if isinstance(mcp_servers, dict) and mcp_servers.pop(self._server_key, None) is not None:
                    if mcp_servers:
                        with open(self._config_path, "w", encoding="utf-8") as f:
                            json.dump(config_data, f, indent=2)
                    else:
                        # Nothing left in the config we or anyone else registered — clean up.
                        self._config_path.unlink(missing_ok=True)
                        with contextlib.suppress(OSError):
                            self._config_path.parent.rmdir()
            except (AttributeError, OSError, TypeError, ValueError) as e:
                logger.warning("Failed to clean up .agents/mcp_config.json: %s", e)
