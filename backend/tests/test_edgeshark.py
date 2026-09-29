"""Edgeshark install: everything browser capture needs, and honest failures."""

import asyncio

import pytest
from fastapi import HTTPException

from app.lab import capture


def _script(monkeypatch, states, pull=(0, "", "")):
    """Fake docker: `states` is a list of {container: state} snapshots served by
    successive `docker ps` calls (the last one repeats)."""
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

    real_sleep = asyncio.sleep

    async def quick_sleep(_seconds):
        await real_sleep(0.001)

    monkeypatch.setattr(capture, "_UP_TIMEOUT", 0.05)
    monkeypatch.setattr(capture, "_docker", fake_docker)
    monkeypatch.setattr(capture, "_fetch_compose_yaml", lambda: "services: {}")
    monkeypatch.setattr(capture.asyncio, "sleep", quick_sleep)
    return calls


UP = {"edgeshark-gostwire-1": "running", "edgeshark-edgeshark-1": "running"}


def test_install_starts_edgeshark_and_pulls_the_wireshark_image(monkeypatch):
    calls = _script(monkeypatch, [UP])
    result = asyncio.run(capture.edgeshark_install())
    assert result.ok
    assert ["pull", capture.WIRESHARK_VNC_IMAGE] in calls


def test_install_reports_a_container_that_does_not_stay_up(monkeypatch):
    _script(monkeypatch, [{"edgeshark-gostwire-1": "restarting", "edgeshark-edgeshark-1": "running"}])
    with pytest.raises(HTTPException) as err:
        asyncio.run(capture.edgeshark_install())
    assert "edgeshark-gostwire-1" in err.value.detail
    assert "cannot open /proc" in err.value.detail


def test_install_says_when_the_wireshark_image_cannot_be_pulled(monkeypatch):
    _script(monkeypatch, [UP], pull=(1, "", "denied: not logged in"))
    with pytest.raises(HTTPException) as err:
        asyncio.run(capture.edgeshark_install())
    assert "denied: not logged in" in err.value.detail
    assert "Edgeshark is running" in err.value.detail


def test_packetflix_is_published_on_the_ui_bind_address_only(monkeypatch):
    monkeypatch.setattr(capture, "CAPTURE_BIND", "127.0.0.1")
    text = capture._publish_on_capture_bind('ports:\n        - "5001:5001"\n')
    assert '"127.0.0.1:5001:5001"' in text
