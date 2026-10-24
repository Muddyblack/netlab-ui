from netlab_ui import cli


def test_bare_flags_mean_serve(monkeypatch):
    seen = {}
    monkeypatch.setattr("uvicorn.run", lambda target, **kw: seen.update(target=target, **kw))
    assert cli.main(["--port", "9123", "--host", "0.0.0.0"]) == 0
    assert seen["port"] == 9123
    assert seen["host"] == "0.0.0.0"
    assert seen["target"] == "netlab_ui.app.main:app"


def test_token_command_creates_a_private_token_once(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("NETLAB_UI_TOKEN", raising=False)
    monkeypatch.delenv("NETLAB_UI_TOKEN_FILE", raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert cli.main(["token"]) == 0
    first = capsys.readouterr().out.strip()
    assert len(first) >= 32
    assert (tmp_path / "netlab-ui" / "token").stat().st_mode & 0o077 == 0
    assert cli.main(["token"]) == 0
    assert capsys.readouterr().out.strip() == first
    assert cli.main(["token", "--rotate"]) == 0
    assert capsys.readouterr().out.strip() != first


def test_upgrade_command_follows_how_it_was_installed():
    assert cli.upgrade_command("/home/a/.local/share/pipx/venvs/netlab-ui") == ["pipx", "upgrade", cli.PACKAGE]
    assert cli.upgrade_command("/nix/store/abc-python3") is None


def test_upgrade_check_reports_newer_release(monkeypatch, capsys):
    monkeypatch.setattr(cli, "installed_version", lambda: "1.0.0")
    monkeypatch.setattr(cli, "latest_version", lambda: "1.1.0")
    assert cli.main(["upgrade", "--check"]) == 10
    assert "1.0.0 -> 1.1.0" in capsys.readouterr().out
    monkeypatch.setattr(cli, "latest_version", lambda: "1.0.0")
    assert cli.main(["upgrade", "--check"]) == 0


def test_upgrade_runs_the_install_command_then_restarts_the_service(monkeypatch):
    ran = []
    monkeypatch.setattr(cli, "installed_version", lambda: "1.0.0")
    monkeypatch.setattr(cli, "latest_version", lambda: "1.1.0")
    monkeypatch.setattr(cli, "upgrade_command", lambda: ["pipx", "upgrade", cli.PACKAGE])
    monkeypatch.setattr(cli.subprocess, "run", lambda cmd, **_kw: ran.append(cmd) or type("R", (), {"returncode": 0})())
    assert cli.main(["upgrade"]) == 0
    assert ran[0] == ["pipx", "upgrade", cli.PACKAGE]
    assert ran[1][:3] == ["systemctl", "--user", "try-restart"]
