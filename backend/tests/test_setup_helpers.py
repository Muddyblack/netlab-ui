import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from services.netlab import runner, setup

CATALOG = {
    "install": [{"id": "ansible", "description": "Ansible"}],
    "builds": [{"id": "bird", "description": "BIRD"}],
    "boxes": ["eos"],
    "tests": ["clab", "libvirt"],
}


@pytest.fixture
def catalog(monkeypatch):
    async def fake():
        return CATALOG

    monkeypatch.setattr(setup, "catalog", fake)


def test_catalog_lists_what_the_installed_netlab_offers():
    setup.reset_cache()
    data = asyncio.run(setup.catalog())
    assert "clab" in data["tests"] and "eos" in data["boxes"]
    assert {"ansible", "containerlab"} <= {item["id"] for item in data["install"]}
    assert all("{%" not in item["description"] for item in data["builds"])


def test_commands_only_accept_what_netlab_offers():
    assert setup.command("test", "clab", CATALOG) == ["test", "clab"]
    assert setup.command("install", "ansible", CATALOG) == ["install", "-y", "ansible"]
    assert setup.command("build", "bird", CATALOG) == ["clab", "build", "bird"]
    with pytest.raises(ValueError):
        setup.command("install", "ansible; rm -rf /", CATALOG)


def _fake_run(lines, code="0"):
    calls = []

    async def run_streaming(args, cwd=None, stdin_text=None):
        calls.append({"args": args, "cwd": cwd, "stdin": stdin_text})
        for line in lines:
            yield "stdout", line
        yield "exit", code

    return calls, run_streaming


def test_a_failed_self_test_is_reported_as_failed_and_cleaned_up(catalog, monkeypatch):
    calls, run_streaming = _fake_run(["Executing netlab up", "The test has failed. We will try to clean up"])
    monkeypatch.setattr(runner, "run_streaming", run_streaming)
    removed = []

    async def remove(workdir):
        removed.append(workdir)

    monkeypatch.setattr(setup, "_remove_test_lab", remove)

    async def collect():
        return [item async for item in setup.stream("test", "clab")]

    items = asyncio.run(collect())
    assert items[-1] == ("exit", "1")
    assert calls[0]["stdin"].startswith("\n") and calls[0]["cwd"] is not None
    assert removed == [calls[0]["cwd"]]


def test_self_test_cleanup_tears_down_the_lab_and_forgets_its_instance(tmp_path, monkeypatch):
    lab = tmp_path / "test"
    lab.mkdir()
    (lab / "netlab.lock").write_text("")
    commands, forgotten = [], []

    async def run_command(args, cwd=None):
        commands.append((args, cwd))
        return runner.CommandResult(0, "", "")

    async def status():
        return {"default": {"dir": str(lab)}, "7": {"dir": "/elsewhere"}}

    monkeypatch.setattr(runner, "run_command", run_command)
    monkeypatch.setattr(runner, "status", status)
    monkeypatch.setattr(setup.location, "forget_status_instance", forgotten.append)
    asyncio.run(setup._remove_test_lab(tmp_path))
    assert commands == [(["down", "--cleanup", "--force"], lab)]
    assert forgotten == ["default"]
    assert not tmp_path.exists()


def test_setup_endpoints(catalog, monkeypatch):
    _calls, run_streaming = _fake_run(["Installing Ansible"])
    monkeypatch.setattr(runner, "run_streaming", run_streaming)
    client = TestClient(app)
    assert client.get("/api/environment/setup").json()["tests"] == ["clab", "libvirt"]
    bad = client.post("/api/environment/setup/stream", json={"action": "install", "target": "nope"})
    assert bad.status_code == 400
    res = client.post("/api/environment/setup/stream", json={"action": "install", "target": "ansible"})
    frames = [json.loads(line[6:]) for line in res.text.splitlines() if line.startswith("data: ")]
    assert frames[0] == {"stream": "stdout", "line": "Installing Ansible"}
    assert frames[-1] == {"done": True, "code": 0}
    assert client.get("/api/environment/setup/box-recipe", params={"device": "nope"}).status_code == 404
