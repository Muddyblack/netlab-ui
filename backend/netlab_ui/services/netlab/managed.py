"""A netlab that netlab-ui installs and keeps up to date itself, in a virtual environment of its own.

For users who have no netlab yet (or want one that does not depend on whatever else is on the machine): the
Settings → Environment page can create ``~/.local/share/netlab-ui/netlab`` and install netlab with Ansible
there, then point the UI at it. Nothing is installed system-wide and no other netlab is touched, so a netlab the
user already runs stays exactly as it is; choosing a different one later is one path in the same page.

Where the environment lives follows where netlab runs: on this machine, or on the host a container sits on
(``location.on_host``), as the host user, with the host's Python.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import signal
import sys
from collections.abc import AsyncIterator
from pathlib import Path

from netlab_ui.services import host
from netlab_ui.services.netlab import location, runner, setup

# Kept in step with the `netlab` extra in backend/pyproject.toml.
PACKAGES = ["networklab>=26.10", "ansible>=9", "ansible-pylibssh>=1.2"]
_VENV_ENV_DROP = {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}


def venv_dir() -> str:
    """Where the managed environment is (a path on the machine netlab runs on)."""
    if location.on_host():
        return f"{host.user().home}/.local/share/netlab-ui/netlab"
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return str(Path(base) / "netlab-ui" / "netlab")


def netlab_path() -> str:
    return f"{venv_dir()}/bin/netlab"


def _exists(path: str) -> bool:
    return (host.host_file(path) if location.on_host() else Path(path)).exists()


def _system_python() -> str | None:
    """The interpreter that creates the environment: python3 here, or on the host's login PATH."""
    if location.on_host():
        return host.which_on_host("python3")
    return shutil.which("python3") or sys.executable


def status() -> dict:
    python = _system_python()
    path = netlab_path()
    return {
        "directory": venv_dir(),
        "installed": _exists(path),
        "netlabPath": path,
        "active": location.resolve().bin_path == path,
        "canInstall": python is not None,
        "python": python,
        "packages": PACKAGES,
        "where": "on the host" if location.on_host() else "on this machine",
    }


def steps(python: str, directory: str) -> list[list[str]]:
    """The commands that create (or refresh) the environment."""
    venv_python = f"{directory}/bin/python"
    return [
        [python, "-m", "venv", directory],
        [venv_python, "-m", "pip", "install", "--upgrade", "pip"],
        [venv_python, "-m", "pip", "install", "--upgrade", *PACKAGES],
    ]


async def _run(argv: list[str]) -> AsyncIterator[tuple[str, str]]:
    env = {k: v for k, v in os.environ.items() if k not in _VENV_ENV_DROP}
    env["PYTHONUNBUFFERED"] = "1"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    argv, env = location.spawn_args(argv, env)
    proc = await asyncio.create_subprocess_exec(
        *argv,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        stdin=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )
    assert proc.stdout is not None
    try:
        async for raw in proc.stdout:
            yield "stdout", raw.decode(errors="replace")
        yield "exit", str(await proc.wait())
    finally:
        if proc.returncode is None:
            # The stream was closed (Stop, or the browser went away): stop pip and anything it started.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGTERM)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), timeout=3)
            if proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(proc.pid, signal.SIGKILL)
                await proc.wait()


async def install() -> AsyncIterator[tuple[str, str]]:
    """Create or update the environment, yielding ``(stream, line)`` then ``("exit", code)``.

    On success the UI is pointed at the new ``netlab`` (the same setting as choosing it by hand)."""
    python = _system_python()
    if python is None:
        yield "stderr", "python3 was not found: install Python 3.10 or newer (and its venv module) first.\n"
        yield "exit", "127"
        return
    directory = venv_dir()
    for argv in steps(python, directory):
        yield "stdout", f"$ {' '.join(argv)}\n"
        code = "1"
        async for stream, line in _run(argv):
            if stream == "exit":
                code = line
            else:
                yield stream, line
        if code != "0":
            yield "exit", code
            return
    path = netlab_path()
    if not _exists(path):
        yield "stderr", f"{path} was not created.\n"
        yield "exit", "1"
        return
    location.set_configured_bin(path)
    runner.reset_version_cache()
    setup.reset_cache()
    yield "stdout", f"netlab-ui now uses {path}\n"
    yield "exit", "0"
