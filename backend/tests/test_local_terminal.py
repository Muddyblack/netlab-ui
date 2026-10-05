"""A normal terminal in the dock: the user's own shell, in the lab folder."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from app.sessions.store import store
from app.shell import ws
from services import host


@pytest.fixture
def lab(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("NETLAB_WORKSPACE_CONFIG", str(tmp_path / "ws.json"))
    (tmp_path / "topology.yml").write_text("name: t\nnodes: [r1]\n")
    host.reset()
    return store.create(str(tmp_path / "topology.yml")).id


@pytest.fixture
def spawned(monkeypatch):
    seen = {}

    async def fake_bridge(websocket, argv, cwd, env=None):
        seen.update(argv=argv, cwd=cwd, env=env)
        await websocket.send_text("hello")
        await websocket.close()

    monkeypatch.setattr(ws, "bridge_pty", fake_bridge)
    return seen


def open_terminal(session):
    with TestClient(app).websocket_connect(f"/api/shell/local?sessionId={session}") as socket:
        return socket.receive_text()


def test_the_terminal_is_the_users_shell_in_the_lab_folder(lab, spawned, monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "local_process_allowed", lambda _host: True)
    monkeypatch.delenv("NETLAB_GUI_IN_CONTAINER", raising=False)
    monkeypatch.setenv("SHELL", "/bin/zsh")
    assert open_terminal(lab) == "hello"
    assert spawned["argv"] == ["/bin/zsh", "-i"] and spawned["cwd"] == Path(tmp_path)


def test_the_terminal_does_not_hand_on_the_login_to_netlab_ui(lab, spawned, monkeypatch):
    monkeypatch.setattr(auth, "local_process_allowed", lambda _host: True)
    monkeypatch.delenv("NETLAB_GUI_IN_CONTAINER", raising=False)
    open_terminal(lab)
    assert spawned["env"]["NETLAB_UI_AUTH"] == "" and spawned["env"]["NETLAB_APP_ASSISTANT_TOKEN"] == ""


def test_in_a_container_that_reaches_the_host_it_is_the_hosts_shell(lab, spawned, monkeypatch):
    monkeypatch.setattr(auth, "local_process_allowed", lambda _host: True)
    monkeypatch.setattr(host, "mode", lambda: "host")
    monkeypatch.setattr(host, "login_shell", lambda: "/run/current-system/sw/bin/zsh")
    seen = {}

    def wrap(argv, env, cwd):
        seen.update(argv=argv, cwd=cwd)
        return ["nsenter", "...", *argv], {"PATH": "/x"}

    monkeypatch.setattr(host, "wrap", wrap)
    open_terminal(lab)
    assert seen["argv"] == ["/run/current-system/sw/bin/zsh", "-i"]
    assert spawned["argv"][0] == "nsenter" and spawned["env"]["PATH"] == "/x"


def test_only_this_machine_may_open_one_without_a_login(lab, spawned, monkeypatch):
    monkeypatch.setattr(auth, "configured_users", dict)
    message = open_terminal(lab)  # the test client is not loopback
    assert "only available from the netlab-ui machine" in message and not spawned


def test_with_a_login_configured_remote_clients_may(lab, spawned, monkeypatch):
    monkeypatch.setattr(auth, "configured_users", lambda: {"alice": "secret"})
    monkeypatch.delenv("NETLAB_GUI_IN_CONTAINER", raising=False)
    assert auth.local_process_allowed("192.168.1.20")
    assert open_terminal(lab) == "hello" and spawned["argv"][-1] == "-i"
