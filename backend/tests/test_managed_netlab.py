import asyncio
import sys

import pytest

from netlab_ui.services.netlab import location, managed


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    monkeypatch.setenv("NETLAB_UI_CONFIG", str(tmp_path / "ui.json"))
    monkeypatch.delenv("NETLAB_BIN", raising=False)
    monkeypatch.setattr(location, "on_host", lambda: False)
    return tmp_path


def _collect(gen):
    async def run():
        return [item async for item in gen]

    return asyncio.run(run())


def test_status_before_install(isolated):
    status = managed.status()
    assert status["directory"] == str(isolated / "data" / "netlab-ui" / "netlab")
    assert status["installed"] is False and status["canInstall"] is True


def test_steps_create_the_venv_then_install_the_packages(isolated):
    venv, _upgrade_pip, packages = managed.steps("/usr/bin/python3", "/d")
    assert venv == ["/usr/bin/python3", "-m", "venv", "/d"]
    assert packages[:5] == ["/d/bin/python", "-m", "pip", "install", "--upgrade"]
    assert any(p.startswith("networklab") for p in packages) and any(p.startswith("ansible") for p in packages)


def test_successful_install_points_the_ui_at_the_new_netlab(isolated, monkeypatch):
    directory = managed.venv_dir()
    fake = [
        [sys.executable, "-m", "venv", directory],  # a real venv, offline
        ["sh", "-c", f"printf '#!/bin/sh\\n' > {directory}/bin/netlab && chmod +x {directory}/bin/netlab"],
    ]
    monkeypatch.setattr(managed, "steps", lambda *_args: fake)
    frames = _collect(managed.install())
    assert frames[-1] == ("exit", "0")
    assert location.get_configured_bin() == f"{directory}/bin/netlab"
    assert managed.status()["installed"] is True


def test_a_failing_step_stops_and_changes_nothing(isolated, monkeypatch):
    monkeypatch.setattr(managed, "steps", lambda *_args: [["sh", "-c", "echo boom; exit 3"], ["false"]])
    frames = _collect(managed.install())
    assert ("stdout", "boom\n") in frames and frames[-1] == ("exit", "3")
    assert location.get_configured_bin() is None


def test_no_python_is_explained(isolated, monkeypatch):
    monkeypatch.setattr(managed, "_system_python", lambda: None)
    frames = _collect(managed.install())
    assert frames[-1] == ("exit", "127") and "python3" in frames[0][1]
