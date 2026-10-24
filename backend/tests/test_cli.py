from netlab_gui import cli


def test_user_unit_has_no_user_line_and_targets_default():
    unit = cli.render_unit(system=False, user="alice")
    assert "User=" not in unit
    assert "WantedBy=default.target" in unit
    assert "serve" in unit


def test_system_unit_runs_as_the_given_user():
    unit = cli.render_unit(system=True, user="alice")
    assert "User=alice" in unit
    assert "WantedBy=multi-user.target" in unit


def test_bare_flags_mean_serve(monkeypatch):
    seen = {}
    monkeypatch.setattr("uvicorn.run", lambda target, **kw: seen.update(target=target, **kw))
    assert cli.main(["--port", "9123", "--host", "0.0.0.0"]) == 0
    assert seen["port"] == 9123
    assert seen["host"] == "0.0.0.0"
    assert seen["target"] == "netlab_gui.app.main:app"


def test_token_command_creates_a_private_token_once(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("NETLAB_GUI_TOKEN", raising=False)
    monkeypatch.delenv("NETLAB_GUI_TOKEN_FILE", raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert cli.main(["token"]) == 0
    first = capsys.readouterr().out.strip()
    assert len(first) >= 32
    assert (tmp_path / "netlab-gui" / "token").stat().st_mode & 0o077 == 0
    assert cli.main(["token"]) == 0
    assert capsys.readouterr().out.strip() == first
    assert cli.main(["token", "--rotate"]) == 0
    assert capsys.readouterr().out.strip() != first
