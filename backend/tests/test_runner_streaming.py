"""Tests for the streaming netlab runner.

Uses a fake ``netlab`` executable on PATH so the tests run without netlab
installed. The fake script emits lines with small delays, which lets us assert
the runner yields output *while the process is still running* (live streaming)
rather than buffering until exit.
"""

import asyncio
import os
import stat
import time

import pytest

from services.netlab import runner

FAKE_NETLAB = """#!/bin/sh
echo "unbuffered=$PYTHONUNBUFFERED"
echo "line one"
sleep 0.4
echo "line two"
echo "to stderr" >&2
exit 7
"""


@pytest.fixture
def fake_netlab(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "netlab"
    script.write_text(FAKE_NETLAB)
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    return script


def test_run_streaming_yields_lines_live_and_reports_exit_code(fake_netlab):
    async def collect():
        events: list[tuple[float, str, str]] = []
        t0 = time.monotonic()
        async for stream, line in runner.run_streaming(["whatever"]):
            events.append((time.monotonic() - t0, stream, line.strip()))
        return events

    events = asyncio.run(collect())

    by_payload = {(stream, line) for _, stream, line in events}
    # PYTHONUNBUFFERED must be set for the child, else Python tools block-buffer
    # their stdout when piped and nothing streams until exit.
    assert ("stdout", "unbuffered=1") in by_payload
    assert ("stdout", "line one") in by_payload
    assert ("stdout", "line two") in by_payload
    assert ("stderr", "to stderr") in by_payload

    # The real exit code is reported as the final event.
    assert events[-1][1:] == ("exit", "7")

    # Liveness: "line one" must arrive well before the process exits (the
    # script sleeps 0.4 s after it). Generous margin to avoid flakes.
    first_line_at = next(t for t, _, line in events if line == "line one")
    exit_at = events[-1][0]
    assert exit_at - first_line_at > 0.2


def test_lifecycle_argv_shared_map():
    args, cwd = runner.lifecycle_argv("create-configs", "/work/lab.yml")
    assert args == ["create", "lab.yml"]
    assert str(cwd) == "/work"
    with pytest.raises(KeyError):
        runner.lifecycle_argv("nope", "/work/lab.yml")


def test_closing_stream_terminates_command_process_group(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    marker = tmp_path / "child-finished"
    script = bin_dir / "netlab"
    script.write_text('#!/bin/sh\necho started\n(sleep 1; echo orphaned > "$MARKER") &\nwait\n')
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("MARKER", str(marker))

    async def cancel_after_first_line():
        stream = runner.run_streaming(["whatever"])
        assert (await anext(stream))[1].strip() == "started"
        await stream.aclose()
        await asyncio.sleep(1.2)

    asyncio.run(cancel_after_first_line())
    assert not marker.exists(), "a cancelled stream left a child process running"


def test_lifecycle_stream_endpoint_rejects_unknown_action():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    res = client.post(
        "/api/lab/lifecycle/stream",
        json={"sessionId": "irrelevant", "action": "rm -rf"},
    )
    assert res.status_code == 400


def test_manage_instance_cleanup_confirms_and_targets_one_instance(monkeypatch):
    seen = {}

    async def fake_status():
        return {"lab-7": {"dir": "/tmp/lab-7", "providers": ["clab"]}}

    async def fake_run(args, cwd=None, *, input_text=None):
        seen.update(args=args, cwd=cwd, input_text=input_text)
        return runner.CommandResult(0, "cleaned", "")

    monkeypatch.setattr(runner, "status", fake_status)
    monkeypatch.setattr(runner, "_run", fake_run)
    result = asyncio.run(runner.manage_instance("lab-7", "cleanup"))

    assert result.code == 0
    assert seen == {
        "args": ["status", "--instance", "lab-7", "--cleanup"],
        "cwd": None,
        "input_text": "yes\n",
    }


def test_instances_endpoint_exposes_stale_directory(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app.lab import lifecycle
    from app.main import app

    async def fake_status():
        return {
            "default": {
                "name": "old-lab",
                "dir": str(tmp_path / "deleted"),
                "status": "started",
                "providers": ["clab"],
            }
        }

    monkeypatch.setattr(lifecycle.runner, "status", fake_status)
    response = TestClient(app).get("/api/lab/instances")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "default",
            "name": "old-lab",
            "directory": str(tmp_path / "deleted"),
            "status": "started",
            "providers": ["clab"],
            "directoryExists": False,
        }
    ]


def test_status_treats_no_tracked_labs_as_empty(monkeypatch):
    async def fake_run(args, cwd=None, *, input_text=None):
        return runner.CommandResult(1, "No netlab-managed labs\n", "")

    monkeypatch.setattr(runner, "_run", fake_run)
    assert asyncio.run(runner.status()) == {}


def test_force_cleanup_recovers_orphaned_containerlab_instance(monkeypatch):
    calls = []

    async def fake_status():
        return {
            "default": {
                "name": "oldlab",
                "dir": "/missing/oldlab",
                "providers": ["clab"],
            }
        }

    async def fake_external(program, args):
        calls.append((program, args))
        if args[:2] == ["ps", "-a"]:
            return runner.CommandResult(0, "clab-oldlab-r1\noldlab_grafana\nunrelated\n", "")
        return runner.CommandResult(0, "removed", "")

    async def fake_forget(instance_id):
        calls.append(("forget", [instance_id]))
        return runner.CommandResult(0, "forgotten", "")

    monkeypatch.setattr(runner, "status", fake_status)
    monkeypatch.setattr(runner, "_run_external", fake_external)
    monkeypatch.setattr(runner, "_forget_instance", fake_forget)

    result = asyncio.run(runner.manage_instance("default", "force-cleanup"))

    assert result.code == 0
    assert calls == [
        ("containerlab", ["destroy", "--name", "oldlab", "--cleanup"]),
        ("docker", ["ps", "-a", "--format", "{{.Names}}"]),
        ("docker", ["rm", "-f", "clab-oldlab-r1", "oldlab_grafana"]),
        ("forget", ["default"]),
    ]


def test_force_cleanup_stream_yields_orphan_recovery_steps_live(monkeypatch):
    # Same orphaned-instance scenario as above, but through the streaming
    # entry point the live-output dialog uses — every step should surface as
    # its own line, not just the final result.
    async def fake_status():
        return {"default": {"name": "oldlab", "dir": "/missing/oldlab", "providers": ["clab"]}}

    async def fake_external(program, args):
        if args[:2] == ["ps", "-a"]:
            return runner.CommandResult(0, "clab-oldlab-r1\n", "")
        return runner.CommandResult(0, "removed", "")

    async def fake_forget(instance_id):
        return runner.CommandResult(0, "forgotten", "")

    monkeypatch.setattr(runner, "status", fake_status)
    monkeypatch.setattr(runner, "_run_external", fake_external)
    monkeypatch.setattr(runner, "_forget_instance", fake_forget)

    async def collect():
        return [item async for item in runner.force_cleanup_stream("default")]

    events = asyncio.run(collect())
    assert events[-1] == ("exit", "0")
    # Progress commentary for each step reached the caller before completion.
    joined = "\n".join(line for stream, line in events if stream == "stdout")
    assert "containerlab destroy" in joined
    assert "Forgetting the tracking record" in joined


def test_force_cleanup_stream_uses_netlab_down_when_directory_exists(tmp_path, monkeypatch):
    directory = tmp_path / "lab"
    directory.mkdir()

    async def fake_status():
        return {"default": {"name": "lab", "dir": str(directory), "providers": ["clab"]}}

    async def fake_run_streaming(args, cwd=None):
        assert args == ["down", "--cleanup", "--force"]
        assert cwd == directory
        yield "stdout", "destroying..."
        yield "exit", "0"

    monkeypatch.setattr(runner, "status", fake_status)
    monkeypatch.setattr(runner, "run_streaming", fake_run_streaming)

    async def collect():
        return [item async for item in runner.force_cleanup_stream("default")]

    events = asyncio.run(collect())
    assert events == [
        ("stdout", "Running netlab down --cleanup --force…"),
        ("stdout", "destroying..."),
        ("exit", "0"),
    ]


def test_force_cleanup_stream_reports_unknown_instance(monkeypatch):
    async def fake_status():
        return {}

    monkeypatch.setattr(runner, "status", fake_status)

    async def collect():
        return [item async for item in runner.force_cleanup_stream("ghost")]

    events = asyncio.run(collect())
    assert events == [("stderr", "Unknown netlab lab instance 'ghost'"), ("exit", "2")]
