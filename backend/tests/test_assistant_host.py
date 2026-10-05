"""Running the user's agent CLIs on the host from inside the container (nsenter)."""

import json
import shlex
import subprocess
from pathlib import Path

import pytest

from services import host
from services.assistant import harness
from services.assistant.config import mcp_token

PASSWD = "alice:x:1000:100:Alice:/home/alice:/bin/zsh\n"


def completed(stdout="", code=0):
    return subprocess.CompletedProcess([], code, stdout, "")


@pytest.fixture(autouse=True)
def fresh():
    host.reset()
    yield
    host.reset()


@pytest.fixture
def on_host(monkeypatch, tmp_path):
    """A container that may enter the host, where the mounted ~/.netlab belongs to uid 1000."""
    monkeypatch.setenv("NETLAB_GUI_IN_CONTAINER", "1")
    monkeypatch.delenv("NETLAB_UI_AGENTS", raising=False)
    monkeypatch.setenv("NETLAB_UI_HOST_UID", "1000")
    monkeypatch.setattr(host, "_MOUNTED_NETLAB_DIR", tmp_path / ".netlab")
    monkeypatch.setattr(host.shutil, "which", lambda name: f"/usr/bin/{name}" if name == "nsenter" else None)
    calls = []

    def run_on_host(argv, timeout=15.0):
        calls.append(argv)
        return completed(PASSWD) if argv[0] == "getent" else completed()

    monkeypatch.setattr(host, "_run_on_host", run_on_host)
    chowned = []
    monkeypatch.setattr(host.os, "chown", lambda path, uid, gid: chowned.append((Path(path), uid, gid)))
    return calls, chowned


def test_outside_a_container_nothing_changes(monkeypatch, tmp_path):
    monkeypatch.delenv("NETLAB_GUI_IN_CONTAINER", raising=False)
    assert host.mode() == "native" and host.note() == ""
    assert host.wrap(["claude", "--x"], {"A": "b"}, tmp_path) == (["claude", "--x"], {"A": "b"})
    written, visible = host.shared_dir()
    assert written == visible


def test_a_container_without_host_access_says_what_is_missing(monkeypatch):
    monkeypatch.setenv("NETLAB_GUI_IN_CONTAINER", "1")
    monkeypatch.delenv("NETLAB_UI_AGENTS", raising=False)
    monkeypatch.setattr(host.shutil, "which", lambda _name: "/usr/bin/nsenter")
    monkeypatch.setattr(host, "_run_on_host", lambda *_a, **_k: completed("", 1))
    assert host.mode() == "container"
    assert "privileged: true and pid: host" in host.note()
    argv = ["claude"]
    assert host.wrap(argv, {}, Path("/lab")) == (argv, {})  # container mode starts nothing on the host


def test_a_container_without_nsenter_or_the_netlab_mount_explains_itself(monkeypatch, tmp_path):
    monkeypatch.setenv("NETLAB_GUI_IN_CONTAINER", "1")
    monkeypatch.delenv("NETLAB_UI_HOST_UID", raising=False)
    monkeypatch.delenv("NETLAB_UI_AGENTS", raising=False)
    monkeypatch.setattr(host.shutil, "which", lambda _name: None)
    assert host.mode() == "container" and "nsenter" in host.note()
    host.reset()
    monkeypatch.setattr(host.shutil, "which", lambda _name: "/usr/bin/nsenter")
    monkeypatch.setattr(host, "_run_on_host", lambda *_a, **_k: completed())
    monkeypatch.setattr(host, "_MOUNTED_NETLAB_DIR", tmp_path / "missing")
    assert host.mode() == "container" and "~/.netlab" in host.note()


def test_the_container_can_be_told_to_stay_out_of_the_host(on_host, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_AGENTS", "container")
    assert host.mode() == "container" and host.note() == ""


def test_the_agent_starts_on_the_host_as_the_host_user(on_host):
    assert host.mode() == "host" and host.note() == ""
    argv, env = host.wrap(
        ["/home/alice/.local/bin/claude", "--mcp-config", "/f x.json"], {"TOK": "s3cret"}, Path("/labs/my lab")
    )
    assert argv[: len(host.NSENTER)] == host.NSENTER
    rest = argv[len(host.NSENTER) :]
    assert rest[:5] == ["setpriv", "--reuid=1000", "--regid=100", "--init-groups", "--"]
    assert rest[5:7] == ["env", "-i"]
    pairs = [part for part in rest if "=" in part and not part.startswith("-")]
    assert "HOME=/home/alice" in pairs and "USER=alice" in pairs and "TERM=xterm-256color" in pairs
    assert "TOK=s3cret" in pairs  # the token travels in the environment ...
    assert rest[-4:-1] == ["/bin/zsh", "-l", "-c"]
    script = rest[-1]
    inner = "cd '/labs/my lab' && exec /home/alice/.local/bin/claude --mcp-config '/f x.json'"
    # the host gives the agent a terminal of its own (the container's pty does not exist there)
    assert script == f"exec script -q -e -f -c {shlex.quote(inner)} /dev/null"
    assert "s3cret" not in script  # ... never in the command the shell is given
    assert env == {"PATH": host.HOST_PATH}  # only for nsenter's own exec of setpriv


def test_without_script_on_the_host_the_agent_is_started_directly(on_host, monkeypatch):
    def run_on_host(argv, timeout=15.0):
        if argv[0] == "getent":
            return completed(PASSWD)
        return completed("", 1) if argv[:2] == ["sh", "-c"] else completed()  # `command -v script` fails

    monkeypatch.setattr(host, "_run_on_host", run_on_host)
    argv, _ = host.wrap(["claude"], {}, Path("/lab"))
    assert argv[-1] == "cd /lab && exec claude"


def test_an_unusual_login_shell_falls_back_to_posix_sh(on_host, monkeypatch):
    monkeypatch.setattr(
        host, "_run_on_host", lambda *_a, **_k: completed("alice:x:1000:100::/home/alice:/usr/bin/fish\n")
    )
    argv, _ = host.wrap(["claude"], {}, Path("/lab"))
    assert argv[-4:-1] == ["/bin/sh", "-l", "-c"]
    assert "SHELL=/bin/sh" in argv


def test_extra_path_directories_come_from_the_environment(on_host, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_HOST_PATH", "/opt/agents/bin")
    argv, _ = host.wrap(["claude"], {}, Path("/lab"))
    assert argv[-1].startswith('PATH="$PATH:/opt/agents/bin"; export PATH; exec script ')


def test_agents_are_looked_up_the_way_the_users_terminal_finds_them(on_host, monkeypatch):
    seen = []

    def login_shell(argv, **_kwargs):
        seen.append(argv)
        # an alias or function shows up without a path: not something to start
        return completed("claude\t/home/alice/.local/bin/claude\ncodex\tcodex: aliased to x\n")

    monkeypatch.setattr(host.subprocess, "run", login_shell)
    found = host.which_all(["claude", "codex", "vibe"])
    assert found == {"claude": "/home/alice/.local/bin/claude", "codex": None, "vibe": None}
    assert seen[0][-3:-1] == ["-l", "-c"] and "command -v" in seen[0][-1]
    host.which_all(["claude"])  # cached: no second shell
    assert len(seen) == 1


def test_files_the_agent_must_read_live_in_the_shared_netlab_folder(on_host, tmp_path):
    _, chowned = on_host
    written, visible = host.shared_dir()
    assert written == tmp_path / ".netlab" / "ui-agents" and visible == Path("/home/alice/.netlab/ui-agents")
    assert (written.stat().st_mode & 0o777) == 0o700
    assert (written, 1000, 100) in chowned


def test_the_mcp_config_is_written_where_the_container_sees_it_and_named_where_the_host_does(
    on_host, tmp_path, monkeypatch
):
    monkeypatch.setattr(host.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(host, "which", lambda name: f"/home/alice/bin/{name}")
    _, chowned = on_host
    argv, _ = harness.launch_spec(harness.get("claude"))
    config = Path(argv[argv.index("--mcp-config") + 1])
    assert config.parent == Path("/home/alice/.netlab/ui-agents")  # what the host's claude is told
    written = tmp_path / ".netlab" / "ui-agents" / config.name  # where this process wrote it
    assert (
        json.loads(written.read_text())["mcpServers"]["netlab"]["headers"]["Authorization"] == f"Bearer {mcp_token()}"
    )
    assert (written, 1000, 100) in chowned


def test_a_project_file_for_the_agent_is_handed_to_the_host_user(on_host, tmp_path, monkeypatch):
    monkeypatch.setattr(host, "which", lambda name: f"/home/alice/bin/{name}")
    _, chowned = on_host
    lab = tmp_path / "lab"
    lab.mkdir()
    harness.launch_spec(harness.get("kiro"), workdir=lab)
    assert (lab / ".kiro" / "settings" / "mcp.json", 1000, 100) in chowned
    assert (lab / ".kiro" / "settings", 1000, 100) in chowned


def test_a_missing_cli_names_the_place_it_was_looked_for(on_host, monkeypatch):
    monkeypatch.setattr(host, "which", lambda _name: None)
    with pytest.raises(FileNotFoundError, match="on the host"):
        harness.launch_spec(harness.get("claude"))
    monkeypatch.setenv("NETLAB_UI_AGENTS", "container")
    with pytest.raises(FileNotFoundError, match="inside the netlab-ui container"):
        harness.launch_spec(harness.get("claude"))
