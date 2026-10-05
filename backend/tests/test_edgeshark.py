"""Edgeshark install: netlab's own edgeshark tool, packetflix kept off public interfaces, honest failures."""

import asyncio

import pytest
from fastapi import HTTPException

from app.lab import capture
from services.netlab import _tools_bridge, runner, tools


def _script(monkeypatch, states, pull=(0, "", ""), tool=(0, "started", "")):
    """Fake docker and netlab: `states` is a list of {container: state} snapshots
    served by successive `docker ps` calls (the last one repeats)."""
    calls = []
    snapshots = list(states)

    async def fake_docker(args, *, input_text=None, timeout=60.0):
        calls.append(args)
        if args[0] == "ps":
            snap = snapshots.pop(0) if len(snapshots) > 1 else snapshots[0]
            return 0, "".join(f"{n}\t{s}\n" for n, s in snap.items()), ""
        if args[0] == "pull":
            return pull
        if args[0] == "logs":
            return 0, "", "boom: cannot open /proc"
        return 0, "", ""

    async def fake_host_tool(name, what, bind=None, timeout=600):
        calls.append(["netlab-tool", name, what, bind])
        return runner.CommandResult(*tool)

    real_sleep = asyncio.sleep

    async def quick_sleep(_seconds):
        await real_sleep(0.001)

    monkeypatch.setattr(capture, "_UP_TIMEOUT", 0.05)
    monkeypatch.setattr(capture, "_docker", fake_docker)
    monkeypatch.setattr(tools, "host_tool", fake_host_tool)
    monkeypatch.setattr(capture.asyncio, "sleep", quick_sleep)
    return calls


UP = {"gostwire": "running", "edgeshark": "running", "unrelated": "exited"}


def test_install_runs_netlabs_tool_on_the_ui_address_and_pulls_wireshark(monkeypatch):
    monkeypatch.setattr(capture, "CAPTURE_BIND", "127.0.0.1")
    calls = _script(monkeypatch, [UP])
    result = asyncio.run(capture.edgeshark_install())
    assert result.ok
    assert ["netlab-tool", "edgeshark", "up", "127.0.0.1"] in calls
    assert ["pull", capture.WIRESHARK_VNC_IMAGE] in calls


def test_install_removes_the_old_compose_install_first(monkeypatch):
    calls = _script(monkeypatch, [{"edgeshark-edgeshark-1": "running", "edgeshark-gostwire-1": "running"}, UP])
    asyncio.run(capture.edgeshark_install())
    removed = next(c for c in calls if c[:2] == ["rm", "-f"])
    assert set(removed[2:]) == {"edgeshark-edgeshark-1", "edgeshark-gostwire-1"}
    assert calls.index(removed) < calls.index(["netlab-tool", "edgeshark", "up", capture.CAPTURE_BIND])


def test_install_reports_a_container_that_does_not_stay_up(monkeypatch):
    _script(monkeypatch, [{"gostwire": "restarting", "edgeshark": "running"}])
    with pytest.raises(HTTPException) as err:
        asyncio.run(capture.edgeshark_install())
    assert "gostwire" in err.value.detail
    assert "cannot open /proc" in err.value.detail


def test_install_reports_netlab_failures(monkeypatch):
    _script(monkeypatch, [{}], tool=(1, "", "this netlab has no edgeshark tool"))
    with pytest.raises(HTTPException) as err:
        asyncio.run(capture.edgeshark_install())
    assert "no edgeshark tool" in err.value.detail


def test_install_says_when_the_wireshark_image_cannot_be_pulled(monkeypatch):
    _script(monkeypatch, [UP], pull=(1, "", "denied: not logged in"))
    with pytest.raises(HTTPException) as err:
        asyncio.run(capture.edgeshark_install())
    assert "denied: not logged in" in err.value.detail
    assert "Edgeshark is running" in err.value.detail


def test_status_and_uninstall_use_netlabs_container_names(monkeypatch):
    calls = _script(monkeypatch, [UP])
    status = asyncio.run(capture.edgeshark_status())
    assert status.installed and status.running
    asyncio.run(capture.edgeshark_uninstall())
    assert ["netlab-tool", "edgeshark", "down", None] in calls


def test_published_ports_are_limited_to_the_bind_address():
    cmds = ['docker run -d --name edgeshark --publish "5001:5001" x', "docker run -p 8080:80 y", "docker network ls"]
    bound, changed = _tools_bridge.bind_published_ports(cmds, "127.0.0.1")
    assert changed
    assert bound[0] == 'docker run -d --name edgeshark --publish "127.0.0.1:5001:5001" x'
    assert bound[1] == "docker run -p 127.0.0.1:8080:80 y"
    assert _tools_bridge.bind_published_ports(['--publish "10.0.0.1:5001:5001"'], "::1")[1] is False
    assert _tools_bridge.bind_published_ports(["-p 5001:5001"], "::1")[0] == ["-p [::1]:5001:5001"]
    assert _tools_bridge.bind_published_ports(cmds, "0.0.0.0") == (cmds, False)
