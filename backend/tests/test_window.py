from netlab_ui import window


def test_without_pywebview_or_chromium_it_falls_back_to_the_browser(monkeypatch):
    opened = []
    monkeypatch.setattr(window, "_pywebview", lambda _url: False)
    monkeypatch.setattr(window, "_chromium_app", lambda _url: False)
    monkeypatch.setattr(window.webbrowser, "open", opened.append)
    monkeypatch.setattr(window.threading.Event, "wait", lambda _self: None)
    window._show("http://127.0.0.1:8000")
    assert opened == ["http://127.0.0.1:8000"]


def test_chromium_app_mode_uses_its_own_profile(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(window.shutil, "which", lambda n: "/bin/chromium" if n == "chromium" else None)
    monkeypatch.setattr(window, "_profile_dir", lambda: str(tmp_path))
    monkeypatch.setattr(window.subprocess, "run", lambda cmd, **_kw: calls.append(cmd))
    assert window._chromium_app("http://x") is True
    assert calls[0][:2] == ["/bin/chromium", "--app=http://x"]
    assert f"--user-data-dir={tmp_path}" in calls[0]


def test_a_missing_pywebview_is_installed_when_the_user_agrees(monkeypatch):
    monkeypatch.setitem(window.sys.modules, "webview", None)  # import raises ImportError
    monkeypatch.setattr(window.sys, "prefix", "/home/u/.local/share/pipx/venvs/netlab-ui")
    monkeypatch.setattr(window.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "y")
    ran = []
    monkeypatch.setattr(
        window.subprocess, "run", lambda cmd, **_kw: ran.append(cmd) or type("R", (), {"returncode": 0})()
    )
    assert window._install_pywebview() is True
    assert ran[0][1:4] == ["-m", "pip", "install"]
    assert window.PYWEBVIEW_SPEC in ran[0]


def test_it_does_not_ask_without_a_terminal(monkeypatch):
    monkeypatch.setattr(window.sys, "prefix", "/home/u/.local/share/pipx/venvs/netlab-ui")
    monkeypatch.setattr(window.sys.stdin, "isatty", lambda: False)
    assert window._install_pywebview() is False
