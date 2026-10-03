"""Agent CLIs started in a terminal tab, pre-connected to the MCP server."""

import json
import os
import stat
from pathlib import Path

import pytest

from services import host
from services.assistant import harness
from services.assistant.config import mcp_token


@pytest.fixture
def installed(monkeypatch):
    monkeypatch.setattr(host.shutil, "which", lambda name: f"/usr/bin/{name}")


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


def test_kiro_gets_a_workspace_file_that_refers_to_the_token_by_variable(installed, tmp_path):
    (tmp_path / ".kiro" / "settings").mkdir(parents=True)
    (tmp_path / ".kiro" / "settings" / "mcp.json").write_text(json.dumps({"mcpServers": {"mine": {"url": "http://x"}}}))
    argv, env = harness.launch_spec(harness.get("kiro"), workdir=tmp_path)
    assert argv == ["/usr/bin/kiro-cli"] and env == {"NETLAB_MCP_TOKEN": mcp_token()}
    text = (tmp_path / ".kiro" / "settings" / "mcp.json").read_text()
    servers = json.loads(text)["mcpServers"]
    assert set(servers) == {"mine", "netlab"}  # the user's own servers stay
    assert servers["netlab"]["headers"]["Authorization"] == "Bearer ${NETLAB_MCP_TOKEN}"
    assert mcp_token() not in text
    # Without a lab folder (or with MCP off) nothing is written.
    assert harness.launch_spec(harness.get("kiro"), with_mcp=False) == (["/usr/bin/kiro-cli"], {})


def test_copilot_is_given_the_server_for_this_session_only(installed):
    argv, env = harness.launch_spec(harness.get("copilot"))
    assert argv[:2] == ["/usr/bin/copilot", "--additional-mcp-config"] and argv[2].startswith("@")
    server = _private(argv[2][1:])["mcpServers"]["netlab"]
    assert server["type"] == "http" and server["tools"] == ["*"] and env == {}


def test_opencode_gets_an_inline_config_from_the_environment(installed):
    argv, env = harness.launch_spec(harness.get("opencode"))
    assert argv == ["/usr/bin/opencode"]
    server = json.loads(env["OPENCODE_CONFIG_CONTENT"])["mcp"]["netlab"]
    assert server["type"] == "remote" and server["headers"]["Authorization"] == f"Bearer {mcp_token()}"


def test_cursor_gets_a_project_file_that_holds_no_token(installed, tmp_path):
    (tmp_path / ".cursor").mkdir()
    (tmp_path / ".cursor" / "mcp.json").write_text(json.dumps({"mcpServers": {"other": {"url": "http://x"}}}))
    argv, env = harness.launch_spec(harness.get("cursor"), workdir=tmp_path)
    assert argv == ["/usr/bin/cursor-agent", "--approve-mcps"] and env == {"NETLAB_MCP_TOKEN": mcp_token()}
    text = (tmp_path / ".cursor" / "mcp.json").read_text()
    servers = json.loads(text)["mcpServers"]
    assert set(servers) == {"other", "netlab"}  # the user's own servers stay
    assert servers["netlab"]["headers"]["Authorization"] == "Bearer ${env:NETLAB_MCP_TOKEN}"
    assert mcp_token() not in text


@pytest.mark.parametrize("harness_id", ["claude", "codex", "copilot", "opencode", "cursor", "kiro"])
def test_the_token_never_reaches_the_command_line(installed, tmp_path, harness_id):
    argv, _env = harness.launch_spec(harness.get(harness_id), workdir=tmp_path)
    assert not any(mcp_token() in arg for arg in argv)


@pytest.mark.parametrize("harness_id", ["antigravity", "cline", "grok", "vibe"])
def test_register_agents_start_plainly_after_registering_in_their_own_config(installed, harness_id):
    selected = harness.get(harness_id)
    assert selected.mcp == "register"
    argv, env = harness.launch_spec(selected)
    assert argv == [f"/usr/bin/{selected.binary}"] and env == {"NETLAB_MCP_TOKEN": mcp_token()}
    commands = harness.setup_commands(selected)
    adds = [c for c, _ in commands if "add" in c]
    assert len(adds) == 1 and adds[0][1:3] == ["mcp", "add"] and "netlab" in adds[0]
    assert any(arg.startswith("http") and arg.endswith("/mcp") for arg in adds[0])
    # Off means off: no registration and a plain start.
    assert harness.setup_commands(selected, with_mcp=False) == []
    assert harness.launch_spec(selected, with_mcp=False) == ([f"/usr/bin/{selected.binary}"], {})


def test_vibe_stores_a_reference_to_the_token_not_the_token(installed):
    commands = harness.setup_commands(harness.get("vibe"))
    assert [c[2] for c, _ in commands] == ["remove", "add"]
    add = commands[1][0]
    assert add[add.index("--bearer-token-env-var") + 1] == "NETLAB_MCP_TOKEN"
    assert not any(mcp_token() in arg for c, _ in commands for arg in c)


def test_manual_agents_start_plainly_and_say_how_to_connect(installed):
    for harness_id in ("junie", "kimi", "qwen", "mimo"):
        selected = harness.get(harness_id)
        assert harness.launch_spec(selected) == ([f"/usr/bin/{selected.binary}"], {})
        assert harness.setup_commands(selected) == []
    listed = {item["id"]: item for item in harness.available()}
    assert listed["junie"]["mcp"] == "manual" and "mcpServers" in listed["junie"]["connect"]["text"]
    assert "kimi mcp add" in listed["kimi"]["connect"]["text"]
    assert "connect" not in listed["claude"]


def test_every_agent_has_a_connection_recipe_for_its_kind():
    kinds = {"session": harness._SESSION, "register": harness._REGISTER, "manual": harness._MANUAL}
    for item in harness.HARNESSES:
        assert item.id in kinds[item.mcp], f"{item.id} is {item.mcp} but has no recipe"
    assert len({h.id for h in harness.HARNESSES}) == len(harness.HARNESSES)


def test_a_failing_setup_step_is_reported_but_never_fatal(tmp_path):
    import asyncio
    import shutil

    from app.assistant import router

    assert asyncio.run(router._run_setup(["/bin/sh", "-c", "exit 0"], {}, tmp_path)) is None
    note = asyncio.run(router._run_setup(["/bin/sh", "-c", "echo boom; exit 3"], {}, tmp_path))
    assert note and "boom" in note
    assert (
        asyncio.run(router._run_setup([shutil.which("false") or "false", "mcp", "remove", "netlab"], {}, tmp_path))
        is None
    )
    assert "could not run" in asyncio.run(router._run_setup(["/no/such/binary", "mcp"], {}, tmp_path))


def test_missing_cli_is_reported(monkeypatch):
    monkeypatch.setattr(host.shutil, "which", lambda _name: None)
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


def test_skip_permissions_is_opt_in_and_only_for_known_flags(installed):
    plain, _ = harness.launch_spec(harness.get("claude"))
    assert "--dangerously-skip-permissions" not in plain
    argv, _ = harness.launch_spec(harness.get("claude"), yolo=True)
    assert argv[-1] == "--dangerously-skip-permissions"
    argv, _ = harness.launch_spec(harness.get("opencode"), yolo=True)
    assert argv == harness.launch_spec(harness.get("opencode"))[0]


def test_kiro_takes_its_trust_flag_on_the_chat_subcommand(installed):
    argv, _ = harness.launch_spec(harness.get("kiro"), yolo=True)
    assert argv[-2:] == ["chat", "--trust-all-tools"]
