import os

from netlab_ui.app.environment import router


def test_resolve_candidate_rejects_arbitrary_executable(tmp_path):
    executable = tmp_path / "not-netlab"
    executable.write_text("#!/bin/sh\nexit 0\n")
    executable.chmod(0o700)

    assert router._resolve_candidate(str(executable)) is None


def test_resolve_candidate_accepts_executable_named_netlab(tmp_path):
    executable = tmp_path / "netlab"
    executable.write_text("#!/bin/sh\nexit 0\n")
    executable.chmod(0o700)

    assert router._resolve_candidate(str(executable)) == os.path.realpath(executable)


def test_warns_when_netsim_differs_from_the_netlab_command():
    from netlab_ui.app.environment import router

    info = {"found": True, "source": "path", "binPath": "/usr/bin/netlab"}
    netsim = {"version": "26.05", "packageDir": "/usr/lib/netsim"}
    messages = router._warnings(info, "netlab 26.10", netsim, {})
    assert any("26.05" in m and "PYTHONPATH" in m for m in messages)
    assert router._warnings(info, "netlab 26.10", {"version": "26.10", "packageDir": "/x"}, {}) == []


def test_container_hint_for_old_netlab_and_missing_netlab(monkeypatch):
    from netlab_ui.app.environment import router
    from netlab_ui.services.netlab import location

    monkeypatch.setattr(location, "on_host", lambda: True)
    info = {"found": True, "source": "path", "binPath": "/usr/bin/netlab"}
    (message,) = router._warnings(info, "netlab 26.05", {"version": "26.05", "packageDir": "/x"}, {})
    assert "NETLAB_UI_TOOL_ENV" in message
    assert router._warnings(info, "netlab 26.05", None, {"PYTHONPATH": "/p"}) == []  # already configured
    (missing,) = router._warnings({"found": False, "source": "default"}, None, None, {})
    assert "No netlab was found on the host" in missing
