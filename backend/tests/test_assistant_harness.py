"""Agent CLIs started in a terminal tab, pre-connected to the MCP server."""

import json
import os
import stat
from pathlib import Path

import pytest

from services.assistant import harness
from services.assistant.config import mcp_token


@pytest.fixture
def installed(monkeypatch):
    monkeypatch.setattr(harness.shutil, "which", lambda name: f"/usr/bin/{name}")


def _private(path: str) -> dict:
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    return json.loads(Path(path).read_text())


def test_claude_gets_mcp_config_from_a_private_file(installed):
    argv, env = harness.launch_spec(harness.get("claude"))
    assert argv[:2] == ["/usr/bin/claude", "--mcp-config"]
    server = _private(argv[2])["mcpServers"]["netlab"]
    assert server["type"] == "http" and server["headers"]["Authorization"] == f"Bearer {mcp_token()}"
    assert env == {}


def test_codex_reads_the_token_from_the_environment(installed):
    argv, env = harness.launch_spec(harness.get("codex"))
    assert argv[0] == "/usr/bin/codex"
    assert any(arg.startswith("mcp_servers.netlab.url=") for arg in argv)
    assert env == {"NETLAB_MCP_TOKEN": mcp_token()}


def test_gemini_gets_a_system_settings_file(installed):
    argv, env = harness.launch_spec(harness.get("gemini"))
    assert argv == ["/usr/bin/gemini"]
    assert "httpUrl" in _private(env["GEMINI_CLI_SYSTEM_SETTINGS_PATH"])["mcpServers"]["netlab"]


@pytest.mark.parametrize("harness_id", ["claude", "codex", "gemini"])
def test_the_token_never_reaches_the_command_line(installed, harness_id):
    argv, _env = harness.launch_spec(harness.get(harness_id))
    assert not any(mcp_token() in arg for arg in argv)


def test_missing_cli_is_reported(monkeypatch):
    monkeypatch.setattr(harness.shutil, "which", lambda _name: None)
    assert not any(item["available"] for item in harness.available())
    with pytest.raises(FileNotFoundError):
        harness.launch_spec(harness.get("claude"))


def test_agent_terminals_need_loopback_or_a_login(monkeypatch):
    from app.assistant import router

    monkeypatch.setattr(router.auth, "configured_users", dict)
    assert router._harness_allowed("127.0.0.1")
    assert router._harness_allowed("::1")
    assert not router._harness_allowed("192.168.1.20")
    assert not router._harness_allowed(None)
    monkeypatch.setattr(router.auth, "configured_users", lambda: {"alice": "secret"})
    assert router._harness_allowed("192.168.1.20")
