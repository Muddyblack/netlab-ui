import pytest

from netlab_ui import cli


@pytest.fixture(autouse=True)
def _netlab_present(monkeypatch):
    """Serving warns when there is no netlab; most tests are not about that."""
    monkeypatch.setattr(cli.location, "is_installed", lambda: True)


def test_bare_flags_mean_serve(monkeypatch):
    seen = {}
    monkeypatch.setattr("uvicorn.run", lambda target, **kw: seen.update(target=target, **kw))
    assert cli.main(["--port", "9123", "--host", "0.0.0.0"]) == 0
    assert seen["port"] == 9123
    assert seen["host"] == "0.0.0.0"
    assert seen["target"] == "netlab_ui.app.main:app"


def test_a_bad_port_variable_is_a_message_not_a_traceback(monkeypatch, capsys):
    monkeypatch.setattr("uvicorn.run", lambda *_a, **_kw: None)
    monkeypatch.setenv("UVICORN_PORT", "eighty")
    assert cli.main([]) == 2
    assert "UVICORN_PORT must be a port number" in capsys.readouterr().err


def test_serving_on_the_network_without_a_login_warns(monkeypatch, capsys):
    monkeypatch.setattr("uvicorn.run", lambda *_a, **_kw: None)
    monkeypatch.setattr(cli.auth, "auth_enabled", lambda: False)
    assert cli.main(["--host", "0.0.0.0"]) == 0
    assert "without a login" in capsys.readouterr().err
    assert cli.main(["--host", "127.0.0.1"]) == 0
    assert capsys.readouterr().err == ""
    monkeypatch.setattr(cli.auth, "auth_enabled", lambda: True)
    assert cli.main(["--host", "0.0.0.0"]) == 0
    assert capsys.readouterr().err == ""


def test_token_command_prints_a_sign_in_link_and_restarts_the_service(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("NETLAB_UI_TOKEN", raising=False)
    monkeypatch.delenv("NETLAB_UI_TOKEN_FILE", raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setattr(cli, "restart_user_service", lambda: True)
    assert cli.main(["token"]) == 0
    captured = capsys.readouterr()
    token = captured.out.strip()
    assert "restarted the netlab-ui service" in captured.err
    assert f"http://127.0.0.1:8000/?token={token}" in captured.err


def test_token_command_creates_a_private_token_once(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("NETLAB_UI_TOKEN", raising=False)
    monkeypatch.delenv("NETLAB_UI_TOKEN_FILE", raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setattr(cli, "restart_user_service", lambda: False)
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
    result = type("R", (), {"returncode": 0, "stdout": "active"})()
    monkeypatch.setattr(cli.subprocess, "run", lambda cmd, **_kw: ran.append(cmd) or result)
    assert cli.main(["upgrade"]) == 0
    assert ran[0] == ["pipx", "upgrade", cli.PACKAGE]
    assert ran[1][:3] == ["systemctl", "--user", "try-restart"]


def test_app_flag_serves_in_a_window(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli.auth, "configured_token", lambda: None)
    monkeypatch.setattr(
        "netlab_ui.window.run",
        lambda server_config, url, mode: seen.update(port=server_config.port, url=url, mode=mode) or 0,
    )
    assert cli.main(["--app", "--host", "0.0.0.0", "--port", "9123"]) == 0
    assert seen == {"port": 9123, "url": "http://127.0.0.1:9123", "mode": "auto"}


def test_app_window_signs_in_with_the_token(monkeypatch):
    monkeypatch.setattr(cli.auth, "configured_token", lambda: "s3cret")
    assert cli._app_url("127.0.0.1", 8000) == "http://127.0.0.1:8000/?token=s3cret"


def test_serve_says_how_to_get_netlab_when_there_is_none(monkeypatch, capsys):
    monkeypatch.setattr("uvicorn.run", lambda *_a, **_kw: None)
    monkeypatch.setattr(cli.location, "is_installed", lambda: False)
    assert cli.main([]) == 0
    assert "netlab-ui netlab install" in capsys.readouterr().err


def test_netlab_install_streams_the_output_and_returns_the_exit_code(monkeypatch, capsys):
    async def fake_install():
        yield "stdout", "creating the environment\n"
        yield "stderr", "a warning\n"
        yield "exit", "0"

    monkeypatch.setattr(cli.managed, "install", fake_install)
    monkeypatch.setattr(
        cli.managed,
        "status",
        lambda: {"canInstall": True, "installed": False, "directory": "/d", "where": "on this machine"},
    )
    assert cli.main(["netlab", "install"]) == 0
    captured = capsys.readouterr()
    assert "creating the environment" in captured.out and "a warning" in captured.err


def test_netlab_install_without_python_is_a_message(monkeypatch, capsys):
    monkeypatch.setattr(
        cli.managed, "status", lambda: {"canInstall": False, "installed": False, "directory": "/d", "where": "x"}
    )
    assert cli.main(["netlab", "install"]) == 1
    assert "python3 was not found" in capsys.readouterr().err


def test_netlab_use_validates_before_saving(monkeypatch, tmp_path, capsys):
    from netlab_ui.app.environment import router as environment

    monkeypatch.setenv("NETLAB_UI_CONFIG", str(tmp_path / "ui.json"))
    monkeypatch.setattr(environment, "_resolve_candidate", lambda _p: None)
    assert cli.main(["netlab", "use", "/nope/netlab"]) == 1
    assert cli.location.get_configured_bin() is None
    monkeypatch.setattr(environment, "_resolve_candidate", lambda _p: "/opt/venv/bin/netlab")
    monkeypatch.setattr(environment, "_runs_as_netlab", lambda _b: True)
    assert cli.main(["netlab", "use", "/opt/venv/bin/netlab"]) == 0
    assert cli.location.get_configured_bin() == "/opt/venv/bin/netlab"
    assert "now uses /opt/venv/bin/netlab" in capsys.readouterr().out


def test_netlab_run_hands_over_to_the_chosen_netlab(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli.location, "netlab_command", lambda: "/opt/venv/bin/netlab")
    monkeypatch.setattr(cli.location, "child_path", lambda: "/opt/venv/bin:/usr/bin")
    monkeypatch.setattr(
        cli.os, "execve", lambda path, argv, env: seen.update(path=path, argv=argv, path_env=env["PATH"])
    )
    cli.main(["netlab", "run", "up", "--no-config"])
    assert seen["argv"] == ["/opt/venv/bin/netlab", "up", "--no-config"]
    assert seen["path_env"].startswith("/opt/venv/bin")
