"""netlab's setup helpers, for the Environment settings.

* ``netlab test <provider>`` — deploys netlab's own small test lab, checks it
  and tears it down: the quickest proof that a provider works on this host.
* ``netlab install <script>`` — netlab's installation scripts (Ansible,
  containerlab, libvirt, GraphViz…). They use apt and sudo on the backend host.
* ``netlab clab build <daemon>`` — builds netlab's routing-daemon containers
  (BIRD, dnsmasq, …).
* ``netlab libvirt config <device>`` — the recipe for building a Vagrant box.
* ``netlab clab tarball`` — a deployed lab as a containerlab-only tarball.

What each command offers comes from netlab's own code, run in netlab's
Python, so the lists always match the installed netlab.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import shutil
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

from services.netlab import location, runner

SetupAction = Literal["test", "install", "build"]

_CATALOG_SCRIPT = r"""
import contextlib, glob, io, json, pathlib, re
from netsim.utils import files as _files
out = {"install": [], "builds": [], "boxes": [], "tests": []}
moddir = _files.get_moddir()
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    try:
        from netsim.cli import install
        setup = install.read_config_setup()
        out["install"] = [
            {"id": name, "description": str(data.get("description", ""))} for name, data in setup.scripts.items()
        ]
    except BaseException:
        pass
    try:
        from netsim.cli.clab import build
        out["builds"] = [
            {"id": name, "description": re.sub(r"\{%.*?%\}", "", build.get_description(path)).strip()}
            for name, path in sorted(build.get_dockerfiles().items())
        ]
    except BaseException:
        pass
out["boxes"] = sorted(pathlib.Path(p).stem for p in glob.glob(str(moddir / "install/libvirt/*.txt")))
out["tests"] = sorted(pathlib.Path(p).stem for p in glob.glob(str(moddir / "templates/tests/*.yml")))
print(json.dumps(out))
"""

_catalog_cache: dict[str, Any] | None = None
_cleanups: set[asyncio.Future[None]] = set()
# How `netlab test` reports a failed step (it still exits 0 after cleanup).
_TEST_FAILED = ("The test has failed", "FatalError in test")


async def catalog() -> dict[str, Any]:
    """Install scripts, buildable daemons, Vagrant box recipes and self-tests."""
    global _catalog_cache
    if _catalog_cache is not None:
        return _catalog_cache
    empty: dict[str, Any] = {"install": [], "builds": [], "boxes": [], "tests": []}
    python = location.target_python()
    if not python or not runner.is_installed():
        return empty
    proc = await asyncio.create_subprocess_exec(
        python,
        "-c",
        _CATALOG_SCRIPT,
        env=runner._child_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _err = await proc.communicate()
    try:
        data = json.loads(out.decode().strip().splitlines()[-1])
    except (IndexError, ValueError):
        return empty
    _catalog_cache = {**empty, **data} if isinstance(data, dict) else empty
    return _catalog_cache


def reset_cache() -> None:
    global _catalog_cache
    _catalog_cache = None


def command(action: SetupAction, target: str, known: dict[str, Any]) -> list[str]:
    """netlab argv for a setup action; ValueError for a target netlab doesn't offer."""
    offered = {
        "test": set(known.get("tests") or []),
        "install": {item["id"] for item in known.get("install") or []},
        "build": {item["id"] for item in known.get("builds") or []},
    }[action]
    if target not in offered:
        raise ValueError(f"netlab offers no {action} {target!r}")
    if action == "test":
        return ["test", target]
    if action == "install":
        return ["install", "-y", target]
    return ["clab", "build", target]


async def stream(action: SetupAction, target: str) -> AsyncIterator[tuple[str, str]]:
    """Run a setup action, yielding ``(stream, line)`` then ``("exit", code)``.

    ``netlab test`` works in a directory of its own (it creates, deploys and
    removes a lab there), which is removed afterwards."""
    args = command(action, target, await catalog())
    workdir = Path(tempfile.mkdtemp(prefix="netlab-ui-selftest-")) if action == "test" else None
    # A failed `netlab test` waits for RETURN before its own cleanup
    # (`netlab down --cleanup --force`); answer it up front.
    stdin_text = "\n" * 4 if action == "test" else None
    failed = False
    try:
        async for stream_name, line in runner.run_streaming(args, cwd=workdir, stdin_text=stdin_text):
            if stream_name == "exit":
                # netlab test cleans up after a failure and then exits 0.
                yield stream_name, "1" if failed and line == "0" else line
                continue
            failed = failed or any(marker in line for marker in _TEST_FAILED)
            yield stream_name, line
    finally:
        if action in {"install", "build"}:
            reset_cache()
        if workdir is not None:
            # Shielded: a stopped stream cancels this generator, but the test
            # lab must still be torn down.
            cleanup = asyncio.ensure_future(_remove_test_lab(workdir))
            _cleanups.add(cleanup)
            cleanup.add_done_callback(_cleanups.discard)
            await asyncio.shield(cleanup)


async def _remove_test_lab(workdir: Path) -> None:
    """Make sure a self-test leaves nothing behind, even when it was stopped
    halfway: tear down a lab still deployed in the test directory, forget
    netlab instances registered there, then delete the directory."""
    lab_dir = workdir / "test"
    if (lab_dir / "netlab.lock").exists() or (lab_dir / "netlab.snapshot.pickle").exists():
        with contextlib.suppress(runner.NetlabError, runner.NetlabNotInstalled, OSError):
            await runner.run_command(["down", "--cleanup", "--force"], cwd=lab_dir)
    with contextlib.suppress(runner.NetlabError, runner.NetlabNotInstalled, OSError):
        instances = await runner.status()
        for instance_id, info in instances.items() if isinstance(instances, dict) else []:
            directory = str((info or {}).get("dir") or "") if isinstance(info, dict) else ""
            if directory.startswith(str(workdir)):
                await asyncio.to_thread(location.forget_status_instance, str(instance_id))
        runner._clear_status_cache()
    shutil.rmtree(workdir, ignore_errors=True)


async def box_recipe(device: str) -> str:
    known = (await catalog()).get("boxes") or []
    if device not in known:
        raise ValueError(f"netlab has no Vagrant box recipe for {device!r}")
    result = await runner.run_command(["libvirt", "config", device])
    return result.stdout if result.code == 0 else result.stderr or result.stdout


async def clab_tarball(topology_path: str | Path) -> tuple[Path, runner.CommandResult]:
    """Build ``<lab>.tar.gz`` of the deployed lab with the devices' current
    configs (``netlab clab tarball``); the caller removes the returned file."""
    lab_dir = Path(topology_path).parent
    # --cleanup only runs when netlab gets that far; remove what a failed run
    # leaves behind, but never a config/ directory the user already had.
    leftovers = [path for path in (lab_dir / "config", lab_dir / "clab.config.yml") if not path.exists()]
    target = Path(tempfile.mkdtemp(prefix="netlab-ui-tarball-")) / f"{lab_dir.name}.tar.gz"
    result = await runner.run_command(["clab", "tarball", "--cleanup", "-q", str(target)], cwd=lab_dir)
    if result.code:
        for path in leftovers:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        if "collect-configs" in result.stdout + result.stderr:
            hint = "netlab couldn't collect the devices' configs — are they configured? Run the initial config first."
            result = runner.CommandResult(result.code, result.stdout, f"{hint}\n\n{result.stderr}")
    return target, result
