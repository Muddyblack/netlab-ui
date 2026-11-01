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
