import subprocess
from pathlib import Path

import pytest

from netlab_ui import config, service


def _done(stdout: str = "", code: int = 0, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess([], code, stdout, stderr)


def test_user_unit_has_no_user_line_and_targets_default():
    unit = service.render_unit(system=False, user="alice")
    assert "User=" not in unit
    assert "WantedBy=default.target" in unit
    assert "serve" in unit


def test_system_unit_runs_as_the_given_user():
    unit = service.render_unit(system=True, user="alice")
    assert "User=alice" in unit
    assert "WantedBy=multi-user.target" in unit


def test_the_unit_sets_path_and_escapes_what_systemd_would_expand():
    unit = service.render_unit(system=False, path_env="/home/a/.local/bin:/odd%dir:/usr/bin")
    assert 'Environment="PATH=/home/a/.local/bin:/odd%%dir:/usr/bin"' in unit
    assert "Environment" not in service.render_unit(system=False)


def test_service_path_puts_the_tool_dirs_first_without_duplicates():
    joined = service.service_path(["/opt/clab", "/usr/bin"], current="/usr/bin:/bin:/opt/clab")
    assert joined.split(":") == ["/opt/clab", "/usr/bin", "/bin"]


def test_find_tool_dirs_reports_each_directory_once(tmp_path):
    first, second = tmp_path / "a", tmp_path / "b"
    first.mkdir()
    second.mkdir()
    for directory, tool in ((first, "netlab"), (first, "ansible-playbook"), (second, "containerlab")):
        exe = directory / tool
        exe.write_text("#!/bin/sh\n")
        exe.chmod(0o755)
    assert service.find_tool_dirs(f"{first}:{second}") == [str(first), str(second)]
    assert service.find_tool_dirs(str(tmp_path / "empty")) == []


class _Loginctl:
    """Stands in for subprocess.run: `loginctl show-user` answers from `linger`, enable-linger may or may not work."""

    def __init__(self, linger: bool, can_enable: bool):
        self.linger, self.can_enable, self.calls = linger, can_enable, []

    def __call__(self, cmd, **_kw):
        self.calls.append(cmd)
        if "enable-linger" in cmd:
            self.linger = self.linger or self.can_enable
            return _done(code=0 if self.can_enable else 1)
        return _done("yes\n" if self.linger else "no\n")


def test_linger_already_on_needs_no_change(monkeypatch):
    fake = _Loginctl(linger=True, can_enable=False)
    monkeypatch.setattr(service.subprocess, "run", fake)
    assert service.ensure_linger() is None
    assert not any("enable-linger" in c for c in fake.calls)


def test_linger_is_enabled_and_checked_afterwards(monkeypatch):
    monkeypatch.setattr(service.subprocess, "run", _Loginctl(linger=False, can_enable=True))
    assert service.ensure_linger() is None


def test_a_failed_linger_is_a_warning_with_the_fix(monkeypatch):
    monkeypatch.setattr(service.subprocess, "run", _Loginctl(linger=False, can_enable=False))
    monkeypatch.setattr(service.getpass, "getuser", lambda: "alice")
    warning = service.ensure_linger()
    assert warning is not None
    assert "sudo loginctl enable-linger alice" in warning
    assert "not start at boot" in warning


@pytest.fixture
def installed(monkeypatch, tmp_path):
    """install() against a fake systemd, with HOME in tmp_path. Returns the list of systemctl calls."""
    calls = []
    monkeypatch.delenv(config.CONFIG_ENV, raising=False)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setattr(service, "_target_user", lambda _system: ("alice", tmp_path))
    monkeypatch.setattr(service, "find_tool_dirs", lambda *_a: ["/home/alice/.local/bin", "/usr/bin"])
    monkeypatch.setattr(service.shutil, "which", lambda name, **_kw: f"/x/{name}")
    monkeypatch.setattr(service, "_systemctl", lambda _system, *argv: calls.append(argv) or _done())
    monkeypatch.setattr(service, "ensure_linger", lambda: None)
    return calls


def test_install_writes_unit_and_config_then_reports_the_running_service(installed, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(service, "wait_until_running", lambda *_a, **_kw: True)
    assert service.install(system=False) == 0

    unit = (tmp_path / ".config/systemd/user/netlab-ui.service").read_text()
    assert 'Environment="PATH=/home/alice/.local/bin:' in unit
    written = config.load(tmp_path / ".config/netlab-ui/config.toml")
    assert written.path == ["/home/alice/.local/bin"]  # the system directory is not worth persisting
    assert ("enable", "--now", "netlab-ui.service") in installed

    out = capsys.readouterr().out
    assert "netlab-ui is running: http://127.0.0.1:8000" in out
    assert "systemctl --user status netlab-ui" in out
    assert "journalctl --user -u netlab-ui -f" in out


def test_install_keeps_an_existing_config(installed, monkeypatch, tmp_path):
    cfg = tmp_path / ".config/netlab-ui/config.toml"
    cfg.parent.mkdir(parents=True)
    cfg.write_text("[server]\nport = 9100\n")
    monkeypatch.setattr(service, "wait_until_running", lambda *_a, **_kw: True)
    service.install(system=False)
    assert cfg.read_text() == "[server]\nport = 9100\n"


def test_install_fails_loudly_when_the_service_does_not_come_up(installed, monkeypatch, capsys):
    monkeypatch.setattr(service, "wait_until_running", lambda *_a, **_kw: False)
    monkeypatch.setattr(service, "recent_log", lambda *_a, **_kw: "ModuleNotFoundError: boom")
    assert service.install(system=False) == 1
    captured = capsys.readouterr()
    assert "did not start" in captured.err
    assert "ModuleNotFoundError: boom" in captured.err
    assert "journalctl --user -u netlab-ui -f" in captured.out


def test_install_surfaces_a_linger_warning_and_missing_tools(installed, monkeypatch, capsys):
    monkeypatch.setattr(service, "wait_until_running", lambda *_a, **_kw: True)
    monkeypatch.setattr(service, "ensure_linger", lambda: "Could not enable lingering")
    monkeypatch.setattr(service.shutil, "which", lambda name, **_kw: None if name == "containerlab" else f"/x/{name}")
    assert service.install(system=False) == 0
    err = capsys.readouterr().err
    assert "Could not enable lingering" in err
    assert "containerlab" in err and "[tools] path" in err


def test_install_stops_when_systemd_is_unreachable(installed, monkeypatch, capsys):
    monkeypatch.setattr(service, "_systemctl", lambda *_a: _done(code=1, stderr="Failed to connect to bus"))
    assert service.install(system=False) == 1
    assert "Failed to connect to bus" in capsys.readouterr().err


def test_wait_reports_failure_without_waiting_out_the_timeout(monkeypatch):
    monkeypatch.setattr(service, "_systemctl", lambda *_a: _done("failed\n"))
    assert service.wait_until_running(False, config.Settings(), timeout=30) is False


def test_wait_needs_the_port_to_answer_too(monkeypatch):
    class _Ok:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    monkeypatch.setattr(service, "_systemctl", lambda *_a: _done("active\n"))
    monkeypatch.setattr(service.time, "sleep", lambda _s: None)
    asked = []
    monkeypatch.setattr(service.urllib.request, "urlopen", lambda url, **_kw: asked.append(url) or _Ok())
    assert service.wait_until_running(False, config.Settings(host="0.0.0.0", port=9123)) is True
    assert asked == ["http://127.0.0.1:9123/api/health"]
    assert Path  # keep import used


def test_base_url_brackets_ipv6():
    assert service.base_url("::1", 8000) == "http://[::1]:8000"
    assert service.base_url("127.0.0.1", 8000) == "http://127.0.0.1:8000"
