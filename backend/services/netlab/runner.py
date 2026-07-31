"""Thin async wrappers around the ``netlab`` CLI.

This is the boundary between the app and the real netlab tool. Everything that
shells out to netlab goes through here so (a) the rest of the code stays
testable without netlab installed, and (b) a future AI/agent tool surface can
call these exact functions.

netlab must be installed on the host running this backend, along with at least
one provider (containerlab and/or libvirt). When netlab is absent, these
functions raise :class:`NetlabNotInstalled` with a clear message; callers (e.g.
the snapshot endpoint) can fall back to a static fixture for local UI work.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services.netlab import location


class NetlabNotInstalled(RuntimeError):
    pass


class NetlabError(RuntimeError):
    def __init__(self, cmd: list[str], code: int, stderr: str):
        self.cmd = cmd
        self.code = code
        self.stderr = stderr
        super().__init__(f"`{' '.join(cmd)}` exited {code}: {stderr.strip()}")


def is_installed() -> bool:
    return location.is_installed()


def is_containerlab_installed() -> bool:
    return shutil.which("containerlab") is not None


def is_libvirt_installed() -> bool:
    return shutil.which("virsh") is not None


def _require() -> None:
    if not is_installed():
        raise NetlabNotInstalled(
            "the `netlab` CLI was not found on PATH; install ipspace/netlab "
            "and a provider (containerlab and/or libvirt) on this host"
        )


@dataclass
class CommandResult:
    code: int
    stdout: str
    stderr: str


def _child_env() -> dict[str, str]:
    """Environment for netlab child processes.

    ``PYTHONUNBUFFERED=1`` is essential for live output: netlab (and the
    Ansible it spawns) are Python, and Python block-buffers stdout (~8 KB)
    when it is a pipe instead of a TTY. Without this, streamed commands
    appear silent until they exit — only stderr (unbuffered) trickles out.
    """
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    # Prepend the resolved netlab's bin/ so a netlab living in its own venv finds
    # that venv's ansible-playbook / containerlab rather than a host copy.
    env["PATH"] = location.child_path()
    return env


async def _spawn(
    args: list[str],
    cwd: Path | None = None,
    *,
    pipe_stdin: bool = False,
    env_extra: dict[str, str] | None = None,
) -> asyncio.subprocess.Process:
    _require()
    netlab_bin = location.netlab_command()
    try:
        # start_new_session detaches the child from the backend's controlling
        # terminal (besides enabling process-group kills for streamed
        # commands). Without it, anything that prompts for input — most
        # notably `sudo` inside netlab's provider commands — reads from the
        # terminal uvicorn was launched in and blocks forever with the UI
        # showing an eternally in-progress command. Detached, such prompts
        # fail immediately with a visible error instead.
        return await asyncio.create_subprocess_exec(
            netlab_bin,
            *args,
            cwd=str(cwd) if cwd else None,
            env=_child_env() | (env_extra or {}),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.PIPE if pipe_stdin else asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        if cwd is not None and not Path(cwd).is_dir():
            raise OSError(f"netlab working directory no longer exists: {cwd}") from exc
        raise NetlabNotInstalled(
            f"netlab binary not found at {netlab_bin!r}; check PATH for the backend process"
        ) from None


async def _run(
    args: list[str],
    cwd: Path | None = None,
    *,
    input_text: str | None = None,
    env_extra: dict[str, str] | None = None,
) -> CommandResult:
    proc = await _spawn(args, cwd, pipe_stdin=input_text is not None, env_extra=env_extra)
    out, err = await proc.communicate(input_text.encode() if input_text is not None else None)
    return CommandResult(proc.returncode or 0, out.decode(), err.decode())


async def run_command(args: list[str], cwd: Path | None = None) -> CommandResult:
    """Run a netlab command and return its captured output."""
    return await _run(args, cwd)


async def spawn_command(args: list[str], cwd: Path | None = None) -> asyncio.subprocess.Process:
    """Start a netlab command for callers that enforce custom output limits."""
    return await _spawn(args, cwd)


async def run_streaming(args: list[str], cwd: Path | None = None) -> AsyncIterator[tuple[str, str]]:
    """Yield ``(stream, line)`` tuples in real time where stream is ``stdout``
    or ``stderr``, followed by a final ``("exit", <code>)`` tuple with the
    process exit code as a string.

    Raises :class:`NetlabNotInstalled` if the binary can't be found.
    """
    # Lifecycle commands launch provider/Ansible children; _spawn puts every
    # command in its own session, so stream cancellation can stop the whole
    # command tree via killpg instead of orphaning those children.
    proc = await _spawn(args, cwd)

    _SENTINEL = object()
    queue: asyncio.Queue = asyncio.Queue()

    async def pump(stream: asyncio.StreamReader, name: str) -> None:
        async for raw in stream:
            await queue.put((name, raw.decode(errors="replace")))
        await queue.put(_SENTINEL)

    tasks = [
        asyncio.create_task(pump(proc.stdout, "stdout")),
        asyncio.create_task(pump(proc.stderr, "stderr")),
    ]
    completed = False
    try:
        done_count = 0
        while done_count < 2:
            item = await queue.get()
            if item is _SENTINEL:
                done_count += 1
            else:
                yield item
        code = await proc.wait()
        completed = True
        yield ("exit", str(code))
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if not completed and proc.returncode is None:
            # Closing the HTTP/SSE stream (including the UI Cancel button)
            # closes this generator. Terminate netlab and everything it
            # spawned; otherwise a cancelled deploy continues in the
            # background and may mutate the lab after the UI says it stopped.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), timeout=3)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(proc.pid, signal.SIGKILL)
                await proc.wait()


async def _run_checked(args: list[str], cwd: Path | None = None) -> str:
    res = await _run(args, cwd)
    if res.code != 0:
        raise NetlabError(["netlab", *args], res.code, res.stderr)
    return res.stdout


_create_locks: dict[tuple[str, bool], asyncio.Lock] = {}
_CREATE_CACHE_LIMIT = 16
_create_cache: dict[tuple[str, bool], tuple[str, dict[str, Any]]] = {}


async def create(topology_path: str | Path, *, isolated: bool = False) -> dict[str, Any]:
    """Transform a topology into the render-ready clab projection plus the full
    transformed snapshot — **without deploying anything**.

    Runs ``netlab create <file> -o config -o provider -o json=<tmpfile>`` in the
    topology's directory: the ``provider`` generator writes ``clab.yml`` (read
    back by :func:`_read_clab_projection`) and ``json=<tmpfile>`` dumps the full
    transformed topology. When the lab is deployed (``netlab.lock`` present),
    ``netlab create`` refuses to run, so ``netlab inspect --format json`` is used
    instead. Returns ``{"snapshot": <transformed topology json>, "clab": <clab
    topology>, ...}``.

    With ``isolated=True`` the command runs in a scratch directory instead, with
    an absolute topology path. Two consequences, both wanted by the canvas:

    * **Nothing is written to the lab directory.** Every artifact (``clab.yml``,
      ``node_files/``) lands in the scratch dir and is discarded. Lab-relative
      resources still resolve, because netlab searches ``topology:`` — the
      topology *file's* directory — alongside the cwd for plugins and custom
      templates (see ``netsim/defaults/paths.yml``).
    * **It works on a deployed lab.** netlab's "cannot create configuration
      files in a locked directory" check is against the cwd, so a scratch cwd
      runs normally and yields a real transform of the *edited* YAML rather than
      ``netlab inspect``'s view of what is currently running.

    That last difference is why this is opt-in: callers wanting the deployed
    reality (the config diff reads the ``node_files/`` that a plain ``create``
    writes into the lab dir) must keep using the default.
    """
    path = Path(topology_path)
    lab_dir = path.parent
    # `-o config` must come before `-o provider`: netlab processes output
    # generators in argument order, and the clab provider validates bind sources
    # in node_files/. On a clean workspace those files do not exist until the
    # config generator runs. `-o json=<file>` dumps the transformed topology.
    # The JSON goes to a temp file rather than stdout because netlab
    # interleaves progress messages ("Created provider configuration file...")
    # with stdout output. (netlab >= 25.x syntax: `format=dest`; the old
    # `-o clab` / `-o json:-` forms are rejected by current netlab.)
    # The cache and lock are keyed by mode as well as path: on a deployed lab the
    # two modes legitimately return different topologies (edited vs. running), so
    # they must never hand each other's artifact back.
    cache_key = (str(path.resolve()), isolated)
    lock = _create_locks.setdefault(cache_key, asyncio.Lock())
    async with lock:
        # The canvas projection, Netlab Lenses and structured reports all use
        # the same transformed topology. Cache the complete artifact here so
        # opening a lens never launches a second `netlab create` for unchanged
        # YAML. The check lives inside the per-topology lock to coalesce callers.
        try:
            source_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            source_hash = ""
        cached = _create_cache.get(cache_key)
        if source_hash and cached and cached[0] == source_hash:
            return cached[1]

        if not isolated and (lab_dir / "netlab.lock").exists():
            # `netlab create` refuses to run while the lab is deployed
            # ("Cannot create configuration files in a locked directory") —
            # and it already ran as part of `netlab up`. Read the deployed
            # transform back from the lab snapshot instead; it describes the
            # topology that is actually running.
            result = await _run(["inspect", "--format", "json"], cwd=lab_dir)
            if result.code != 0:
                raise NetlabError(["netlab", "inspect"], result.code, result.stderr or result.stdout)
            snapshot = json.loads(result.stdout)
            clab = _read_clab_projection(lab_dir, snapshot)
        else:
            with contextlib.ExitStack() as stack:
                if isolated:
                    # Scratch cwd: keeps every generated artifact out of the lab
                    # directory and sidesteps the locked-directory refusal.
                    cwd = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="netlab_isolated_")))
                    topology_arg = str(path.resolve())
                    # Importing a lab-local plugin would otherwise drop a
                    # __pycache__ into the lab directory — the one write that
                    # would still escape the scratch dir.
                    env_extra = {"PYTHONDONTWRITEBYTECODE": "1"}
                else:
                    cwd = lab_dir
                    topology_arg = path.name
                    env_extra = None
                fd, json_path = tempfile.mkstemp(prefix="netlab_create_", suffix=".json")
                os.close(fd)
                try:
                    result = await _run(
                        [
                            "create",
                            topology_arg,
                            "-o",
                            "config",
                            "-o",
                            "provider",
                            "-o",
                            f"json={json_path}",
                        ],
                        cwd=cwd,
                        env_extra=env_extra,
                    )
                    if result.code != 0:
                        raise NetlabError(
                            ["netlab", "create", topology_arg], result.code, result.stderr or result.stdout
                        )
                    snapshot = json.loads(Path(json_path).read_text())
                finally:
                    Path(json_path).unlink(missing_ok=True)
                # Read the projection before the scratch dir is cleaned up.
                clab = _read_clab_projection(cwd, snapshot)
        artifact = {
            "snapshot": snapshot,
            "clab": clab,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "source_hash": source_hash,
        }
        if source_hash:
            if len(_create_cache) >= _CREATE_CACHE_LIMIT and cache_key not in _create_cache:
                _create_cache.pop(next(iter(_create_cache)))
            _create_cache[cache_key] = (source_hash, artifact)
        return artifact


def _read_clab_projection(cwd: Path, snapshot: dict[str, Any]) -> dict[str, Any] | None:
    name = snapshot.get("name", "")
    for candidate in (cwd / "clab.yml", cwd / f"{name}.clab.yml"):
        if candidate.exists():
            from ruamel.yaml import YAML

            return YAML(typ="safe").load(candidate.read_text())
    return None


def read_existing_clab(topology_path: str | Path) -> dict[str, Any] | None:
    """Return the clab projection already on disk in the lab directory.

    ``netlab create`` refuses to run while the lab is deployed (netlab.lock
    exists), so a fresh transform is impossible exactly when the lab is up.
    ``netlab up`` wrote ``clab.yml`` at deploy time — read that instead; it is
    the projection of the topology that is actually running."""
    candidate = Path(topology_path).parent / "clab.yml"
    if not candidate.exists():
        return None
    from ruamel.yaml import YAML

    try:
        return YAML(typ="safe").load(candidate.read_text())
    except Exception:  # noqa: BLE001 — an unparseable projection is the same as none
        return None


# `netlab status` costs seconds of CLI startup regardless of lab size, and it
# is requested from two places: the 5 s SSE status poller and every topology
# snapshot build. Share one result via a short-TTL cache so a snapshot right
# after a status poll (the common case) is free instead of paying ~4 s again.
_status_cache: tuple[float, Any] | None = None
_status_lock = asyncio.Lock()
_lab_status_cache: dict[str, tuple[float, Any]] = {}
_lab_status_locks: dict[str, asyncio.Lock] = {}


async def status() -> Any:
    """Return all active labs, enriched with their per-node provider state."""
    global _status_cache
    status_result = await _run(["status", "--format", "json", "--all"])
    if status_result.code != 0:
        output = status_result.stderr or status_result.stdout
        if "No netlab-managed labs" in output:
            result = {}
        else:
            raise NetlabError(
                ["netlab", "status", "--format", "json", "--all"],
                status_result.code,
                output,
            )
    else:
        result = json.loads(status_result.stdout)
    if isinstance(result, dict):

        async def enrich(key: str, summary: Any) -> tuple[str, Any]:
            if not isinstance(summary, dict) or not summary.get("dir"):
                return key, summary
            try:
                detail_out = await _run_checked(
                    ["status", "--format", "json"],
                    cwd=Path(str(summary["dir"])),
                )
                detail = json.loads(detail_out)
                return key, {**summary, **detail} if isinstance(detail, dict) else summary
            except (NetlabError, NetlabNotInstalled, OSError, json.JSONDecodeError):
                return key, summary

        result = dict(await asyncio.gather(*(enrich(str(key), value) for key, value in result.items())))
    _status_cache = (time.monotonic(), result)
    return result


def _clear_status_cache() -> None:
    global _status_cache
    _status_cache = None
    _lab_status_cache.clear()


async def _run_external(program: str, args: list[str]) -> CommandResult:
    binary = shutil.which(program)
    if not binary:
        return CommandResult(127, "", f"Required command {program!r} was not found on PATH")
    proc = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return CommandResult(proc.returncode or 0, stdout.decode(), stderr.decode())


async def _forget_instance(instance_id: str) -> CommandResult:
    try:
        await asyncio.to_thread(location.forget_status_instance, instance_id)
        return CommandResult(
            0,
            f"Forgot netlab lab instance {instance_id!r}. Provider resources were not removed.",
            "",
        )
    except (ImportError, OSError, RuntimeError) as exc:
        return CommandResult(1, "", f"Could not update the netlab status file: {exc}")


async def _force_cleanup_orphaned_clab_stream(
    instance_id: str, summary: dict[str, Any]
) -> AsyncIterator[tuple[str, str]]:
    """Recover a named containerlab-only instance whose lab directory is gone,
    yielding ``(stream, line)`` like :func:`run_streaming` (final tuple is
    ``("exit", code)``) so the live-output SSE endpoint can show each step as
    it happens rather than only the end result."""
    name = str(summary.get("name") or "").strip()
    providers = {str(provider) for provider in summary.get("providers", [])}
    if not name or providers != {"clab"}:
        yield (
            "stderr",
            "Automatic recovery without the lab directory is only supported for a named containerlab-only instance.",
        )
        yield "exit", "2"
        return

    yield "stdout", f"Running containerlab destroy --name {name} --cleanup…"
    clab_result = await _run_external("containerlab", ["destroy", "--name", name, "--cleanup"])
    for line in (clab_result.stdout + clab_result.stderr).splitlines():
        if line.strip():
            yield "stdout", line
    clab_output = f"{clab_result.stdout}\n{clab_result.stderr}".lower()
    if clab_result.code != 0 and "no running containers" not in clab_output:
        yield "exit", str(clab_result.code)
        return

    # netlab external tools use the exact "<lab-name>_" prefix. Remove those
    # containers too, but intentionally retain data volumes and shared
    # management networks.
    yield "stdout", "Listing containers to find tool sidecars…"
    list_result = await _run_external("docker", ["ps", "-a", "--format", "{{.Names}}"])
    if list_result.code != 0:
        for line in list_result.stderr.splitlines():
            yield "stderr", line
        yield "exit", str(list_result.code)
        return
    orphan_names = [
        line
        for line in list_result.stdout.splitlines()
        if line.startswith(f"{name}_") or line.startswith(f"clab-{name}-")
    ]
    if orphan_names:
        yield "stdout", f"Removing {len(orphan_names)} tool container(s)…"
        tools_result = await _run_external("docker", ["rm", "-f", *orphan_names])
        for line in (tools_result.stdout + tools_result.stderr).splitlines():
            if line.strip():
                yield "stdout", line
        if tools_result.code != 0:
            yield "exit", str(tools_result.code)
            return

    yield "stdout", "Forgetting the tracking record…"
    forget_result = await _forget_instance(instance_id)
    if forget_result.code != 0:
        yield "stderr", forget_result.stderr
        yield "exit", str(forget_result.code)
        return
    yield (
        "stdout",
        f"Removed orphaned containerlab resources and forgot instance {instance_id!r}. "
        "Persistent volumes were retained.",
    )
    yield "exit", "0"


async def _force_cleanup_orphaned_clab(instance_id: str, summary: dict[str, Any]) -> CommandResult:
    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    code = 0
    async for stream, line in _force_cleanup_orphaned_clab_stream(instance_id, summary):
        if stream == "exit":
            code = int(line)
        elif stream == "stderr":
            stderr_lines.append(line)
        else:
            stdout_lines.append(line)
    return CommandResult(code, "\n".join(stdout_lines), "\n".join(stderr_lines))


async def force_cleanup_stream(instance_id: str) -> AsyncIterator[tuple[str, str]]:
    """Like ``manage_instance(id, "force-cleanup")`` but yields ``(stream,
    line)`` tuples live, for the lightweight force-cleanup progress dialog —
    no session or topology path required, since the instance's directory may
    not even exist any more."""
    labs = await status()
    summary = labs.get(instance_id) if isinstance(labs, dict) else None
    if not isinstance(summary, dict):
        yield "stderr", f"Unknown netlab lab instance {instance_id!r}"
        yield "exit", "2"
        return

    directory = Path(str(summary.get("dir", "")))
    if directory.is_dir():
        yield "stdout", "Running netlab down --cleanup --force…"
        async for stream, line in run_streaming(["down", "--cleanup", "--force"], cwd=directory):
            yield stream, line
    else:
        async for stream, line in _force_cleanup_orphaned_clab_stream(instance_id, summary):
            yield stream, line
    _clear_status_cache()


async def manage_instance(instance_id: str, action: str) -> CommandResult:
    """Clean up or forget one entry from netlab's global lab registry."""
    labs = await status()
    summary = labs.get(instance_id) if isinstance(labs, dict) else None
    if not isinstance(summary, dict):
        return CommandResult(2, "", f"Unknown netlab lab instance {instance_id!r}")

    directory = Path(str(summary.get("dir", "")))
    if action == "cleanup":
        result = await _run(
            ["status", "--instance", instance_id, "--cleanup"],
            input_text="yes\n",
        )
    elif action == "force-cleanup":
        if directory.is_dir():
            result = await _run(["down", "--cleanup", "--force"], cwd=directory)
        else:
            result = await _force_cleanup_orphaned_clab(instance_id, summary)
    elif action == "forget":
        result = await _forget_instance(instance_id)
    else:
        return CommandResult(2, "", f"Unsupported instance action {action!r}")

    _clear_status_cache()
    return result


async def status_cached(max_age: float = 6.0) -> Any:
    """Like :func:`status`, but reuse a result younger than ``max_age`` seconds
    and coalesce concurrent callers into a single CLI run."""
    if _status_cache and time.monotonic() - _status_cache[0] < max_age:
        return _status_cache[1]
    async with _status_lock:
        if _status_cache and time.monotonic() - _status_cache[0] < max_age:
            return _status_cache[1]
        return await status()


async def status_for(topology_path: str | Path, max_age: float = 4.0) -> Any:
    """Return node-level status for the lab containing ``topology_path``.

    ``netlab status --all`` only returns lab summaries. Running the command in
    the lab directory without ``--all`` is what adds provider container names
    and per-node states.
    """
    key = str(Path(topology_path).resolve())
    cached = _lab_status_cache.get(key)
    if cached and time.monotonic() - cached[0] < max_age:
        return cached[1]
    lock = _lab_status_locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = _lab_status_cache.get(key)
        if cached and time.monotonic() - cached[0] < max_age:
            return cached[1]
        out = await _run_checked(["status", "--format", "json"], cwd=Path(topology_path).parent)
        result = json.loads(out)
        _lab_status_cache[key] = (time.monotonic(), result)
        return result


def normalize_node_state(raw: str | None) -> str:
    """Map provider node status strings onto canonical clab-ui states.

    netlab passes docker's human status through verbatim ("Up 2 minutes",
    "Up 10 seconds (Paused)", "Exited (0) 3 minutes ago"), so anything that
    compares against the literal "running" never matches."""
    text = (raw or "").strip().lower()
    if not text:
        return "unknown"
    if "paused" in text:
        return "paused"
    if text.startswith("up") or "running" in text or "healthy" in text:
        return "running"
    if text.startswith(("exited", "created", "dead")) or "stopped" in text or "shut" in text:
        return "stopped"
    return "unknown"


async def netem_set(
    container_name: str,
    interface: str,
    *,
    delay: str = "",
    jitter: str = "",
    loss: str = "",
    rate: str = "",
    corruption: str = "",
) -> CommandResult:
    """Apply (or clear, when all fields are empty) netem impairments on one
    container interface via `containerlab tools netem set`."""

    def _ms(value: str) -> str:
        text = value.strip()
        return f"{text}ms" if text.isdigit() else text

    args = ["tools", "netem", "set", "-n", container_name, "-i", interface]
    if delay.strip():
        args += ["--delay", _ms(delay)]
    if jitter.strip():
        args += ["--jitter", _ms(jitter)]
    if loss.strip():
        args += ["--loss", loss.strip()]
    if rate.strip():
        args += ["--rate", rate.strip()]
    if corruption.strip():
        args += ["--corruption", corruption.strip()]
    return await _run_external("containerlab", args)


def container_runtime_binary(preferred: str = "") -> str | None:
    """Resolve the configured containerlab runtime without invoking a shell."""
    for candidate in (preferred, "docker", "podman"):
        if candidate in {"docker", "podman"} and (binary := shutil.which(candidate)):
            return binary
    return None


# Whether the installed containerlab knows `apply` (added in 0.77) — probed
# once per process. `apply` reconciles a lab to its topology, re-creating the
# veth links a stopped/restarted container loses with older releases.
_clab_apply_supported: bool | None = None

NODE_ACTIONS = frozenset({"start", "stop", "restart", "pause", "unpause"})


async def _clab_supports_apply() -> bool:
    global _clab_apply_supported
    if _clab_apply_supported is None:
        probe = await _run_external("containerlab", ["apply", "--help"])
        _clab_apply_supported = probe.code == 0
    return _clab_apply_supported


async def container_action(
    container_name: str,
    action: str,
    preferred_runtime: str = "",
    lab_dir: Path | None = None,
) -> CommandResult:
    """Start/stop/restart/pause/unpause one lab container via docker/podman.

    After a start or restart, reconcile the lab with `containerlab apply`
    (0.77+) when available so inter-node veth links are re-established; on
    older containerlab releases the action still runs, but relinking may
    require a redeploy.
    """
    if action not in NODE_ACTIONS:
        return CommandResult(2, "", f"Unsupported node action {action!r}")
    runtime_bin = container_runtime_binary(preferred_runtime)
    if not runtime_bin:
        return CommandResult(127, "", "No docker/podman container runtime found on PATH")
    result = await _run_external(runtime_bin, [action, container_name])
    if result.code != 0 and action in {"start", "restart"} and "paused" in result.stderr.lower():
        # `docker start` refuses paused containers; resuming is what the user
        # meant, so do that instead of surfacing docker's hint verbatim.
        result = await _run_external(runtime_bin, ["unpause", container_name])
    _clear_status_cache()
    if result.code != 0 or action in {"stop", "pause", "unpause"}:
        return result
    clab_topology = (lab_dir / "clab.yml") if lab_dir else None
    if clab_topology and clab_topology.is_file():
        if await _clab_supports_apply():
            reconcile = await _run_external("containerlab", ["apply", "-t", str(clab_topology)])
            _clear_status_cache()
            if reconcile.code != 0:
                return CommandResult(
                    result.code,
                    result.stdout,
                    f"{action} succeeded, but link reconciliation failed:\n{reconcile.stderr or reconcile.stdout}",
                )
        else:
            return CommandResult(
                result.code,
                result.stdout,
                f"{action} succeeded, but this containerlab release cannot reconcile links "
                "(`containerlab apply` needs 0.77+): the node came back with only its mgmt "
                "interface. Recreate its links with `containerlab tools veth create` or "
                "redeploy the lab, then rerun netlab initial for the node.",
            )
    return result


async def container_interfaces(container_name: str, preferred_runtime: str = "") -> list[dict[str, Any]]:
    """Read Linux interface state/counters from a running Docker or Podman container."""
    runtime_bin = container_runtime_binary(preferred_runtime)
    if not runtime_bin:
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            runtime_bin,
            "exec",
            container_name,
            "ip",
            "-j",
            "-s",
            "link",
            "show",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            return []
        value = json.loads(stdout.decode())
        return value if isinstance(value, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


async def docker_interfaces(container_name: str) -> list[dict[str, Any]]:
    """Backward-compatible wrapper for callers that explicitly require Docker."""
    return await container_interfaces(container_name, "docker")


# Lifecycle actions that operate on a topology file in its own directory.
# Single source of truth for argv — shared by the buffered wrappers below and
# the SSE streaming endpoint (`POST /api/lab/lifecycle/stream`).
LIFECYCLE_ACTIONS: dict[str, list[str]] = {
    "up": ["up"],
    "down": ["down"],
    "initial": ["initial"],
    "create-configs": ["create"],
    "restart": ["restart"],
    "validate": ["validate"],
    "collect": ["collect"],
}


# Actions whose netlab CLI parser accepts a positional topology-file argument.
# The rest ('netlab down'/'restart'/'validate'/'collect'/'initial') read the
# already-running lab's state (snapshot/status file) from the working
# directory instead, and some of them (down, restart, validate) use a strict
# argparse.parse_args that raises "unrecognized arguments" if handed one
# anyway — cwd alone is both necessary and sufficient for those.
_ACCEPTS_TOPOLOGY_ARG = {"up", "create-configs"}


def lifecycle_argv(action: str, topology_path: str | Path) -> tuple[list[str], Path]:
    """Return ``(args, cwd)`` for a lifecycle ``action``; raises ``KeyError``
    for unknown actions."""
    path = Path(topology_path)
    args = list(LIFECYCLE_ACTIONS[action])
    if action in _ACCEPTS_TOPOLOGY_ARG:
        args.append(path.name)
    return args, path.parent


async def _run_lifecycle(action: str, topology_path: str | Path) -> CommandResult:
    args, cwd = lifecycle_argv(action, topology_path)
    return await _run(args, cwd=cwd)


async def up(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("up", topology_path)


async def down(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("down", topology_path)


async def initial(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("initial", topology_path)


async def generate_configs(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("create-configs", topology_path)


async def restart(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("restart", topology_path)


async def collect(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("collect", topology_path)


async def validate(topology_path: str | Path) -> CommandResult:
    return await _run_lifecycle("validate", topology_path)


async def graph(topology_path: str | Path, output_format: str = "d2") -> CommandResult:
    path = Path(topology_path)
    engine = "graphviz" if output_format in {"horizontal", "vertical"} else "d2"
    fd, output_path = tempfile.mkstemp(prefix="netlab_graph_", suffix=".svg")
    os.close(fd)
    try:
        # `netlab graph`'s `--format` only accepts module-specific keywords
        # ("vlan" for topology graphs, "rr"/"vrf"/... for bgp graphs) -
        # `rankdir` was never a supported formatting parameter, so passing it
        # always failed with "Invalid topology graph formatting parameter
        # rankdir". graphviz's default rank direction is already top-to-bottom
        # ("vertical"), so there's nothing to pass for either layout.
        args = ["graph", "--engine", engine, "--topology", path.name, output_path]
        result = await _run(args, cwd=path.parent)
        if result.code == 0:
            try:
                svg = Path(output_path).read_text(encoding="utf-8")
            except OSError as exc:
                return CommandResult(1, result.stdout, f"Could not read generated graph: {exc}")
            if not svg.strip():
                # `netlab graph` exits 0 even when it can't find the
                # graphviz/d2 binary on PATH - it only logs a warning and
                # skips rendering, leaving the output file empty. Surface
                # that as a failure instead of handing the frontend an empty
                # "SVG" it can't parse.
                missing_tool_hint = (
                    "netlab did not produce a graph — is the required rendering tool (graphviz/d2) installed?"
                )
                return CommandResult(1, result.stdout, result.stderr or missing_tool_hint)
            return CommandResult(0, svg, result.stderr)
        return result
    finally:
        with contextlib.suppress(OSError):
            os.unlink(output_path)


# "interactive" is deliberately excluded here: it's clab-io-draw's own
# full-screen terminal wizard (assign-levels TUI, needs arrow keys/space/enter)
# requiring a real TTY. A plain subprocess spawned via `_run_external` has
# none, so the wizard just sits there rendering frames forever — verified by
# hand, it doesn't error, it hangs (had to `docker rm -f` the stuck helper
# container). It's only reachable via `drawio_interactive_argv` below, which
# runs under a real PTY bridged to the browser (same mechanism as node
# shells), so the user can actually drive the wizard's keyboard prompts.
DRAWIO_LAYOUTS = frozenset({"vertical", "horizontal"})


async def export_drawio(topology_path: str | Path, layout: str = "vertical") -> CommandResult:
    """`containerlab graph --drawio` (via the clab-io-draw helper container) —
    a genuine draw.io/mxGraph diagram, distinct from netlab's own SVG `graph()`
    above. Needs Docker and the containerlab-generated `clab.yml` (written by
    `netlab create-configs`/`up`), not netlab's own topology file.

    containerlab only bind-mounts the `--topo` file's own directory into the
    helper container, so the `.drawio` output always lands next to `clab.yml`
    in the lab directory — there is no way to redirect it elsewhere via the
    CLI, so it's read back from there rather than treated as a throwaway
    tempfile (unlike `graph()`'s SVG output).
    """
    if layout not in DRAWIO_LAYOUTS:
        return CommandResult(2, "", f"Unsupported drawio layout {layout!r}")
    clab_topology = Path(topology_path).parent / "clab.yml"
    if not clab_topology.is_file():
        return CommandResult(1, "", "No generated containerlab topology (clab.yml) found — run Create or Deploy first.")
    args = ["graph", "--drawio", "--topo", str(clab_topology)]
    if layout == "horizontal":
        args += ["--drawio-args", "--layout", "--drawio-args", "horizontal"]
    result = await _run_external("containerlab", args)
    if result.code != 0:
        return result
    drawio_path = clab_topology.with_suffix(".drawio")
    try:
        return CommandResult(0, drawio_path.read_text(encoding="utf-8"), result.stderr)
    except OSError as exc:
        return CommandResult(1, result.stdout, f"containerlab reported success but no .drawio file was written: {exc}")


def drawio_interactive_argv(topology_path: str | Path) -> list[str]:
    """Argv for clab-io-draw's interactive assign-levels wizard. Used by the
    PTY/WebSocket bridge (see app/shell/ws.py) instead of `export_drawio()`'s
    plain-subprocess path, since this mode needs a real TTY to render its
    terminal UI and receive keyboard input."""
    if not is_containerlab_installed():
        raise NetlabNotInstalled("`containerlab` was not found on PATH")
    clab_topology = Path(topology_path).parent / "clab.yml"
    if not clab_topology.is_file():
        raise FileNotFoundError("No generated containerlab topology (clab.yml) found — run Create or Deploy first.")
    return ["containerlab", "graph", "--drawio", "--topo", str(clab_topology), "--drawio-args", "--interactive"]


async def inspect(topology_path: str | Path) -> CommandResult:
    path = Path(topology_path)
    return await _run(
        ["inspect", "--all", "--format", "yaml", "--topology", path.name],
        cwd=path.parent,
    )


FCLI_COMMANDS = frozenset({"bgp-peers", "bgp-rib", "ipv4-rib", "lldp", "mac", "ni", "subif", "sys-info"})


async def fcli(topology_path: str | Path, command: str) -> CommandResult:
    """Run one read-only nornir-srl/fcli report against a deployed clab lab."""
    if command not in FCLI_COMMANDS:
        return CommandResult(2, "", f"Unsupported fcli command {command!r}")
    path = Path(topology_path)
    clab_path = path.parent / "clab.yml"
    if not clab_path.is_file():
        return CommandResult(2, "", "Generated clab.yml not found; deploy the lab first")
    runtime_bin = container_runtime_binary()
    if not runtime_bin:
        return CommandResult(127, "", "Docker or Podman is required to run fcli")

    network = "clab"
    try:
        from ruamel.yaml import YAML

        document = YAML(typ="safe").load(clab_path.read_text(encoding="utf-8")) or {}
        network = str(((document.get("mgmt") or {}).get("network")) or "clab")
    except (OSError, AttributeError, TypeError, ValueError):
        pass

    return await _run_external(
        runtime_bin,
        [
            "run",
            "--pull",
            "always",
            "--network",
            network,
            "--rm",
            "-v",
            "/etc/hosts:/etc/hosts:ro",
            "-v",
            f"{clab_path.resolve()}:/topo.yml:ro",
            "ghcr.io/srl-labs/nornir-srl:latest",
            "-t",
            "/topo.yml",
            command,
        ],
    )


async def version() -> CommandResult:
    # `netlab --version` is not a recognized flag on current (calendar-versioned,
    # e.g. 26.07) releases — the version lives behind the `version` subcommand,
    # whose first line reads "netlab version <X.Y[.Z]>".
    return await _run(["version"])


def _tool_output(binary: str, args: list[str], timeout: float = 3) -> tuple[str, str] | None:
    """Run a small tool probe without subprocess pipes.

    Some CLIs spawn helpers that inherit stdout/stderr. ``subprocess.run`` then
    waits forever for those inherited pipe handles after a timeout, especially
    when FastAPI invokes a sync route in its worker thread. Temporary files and
    a dedicated process group make the timeout deterministic.
    """
    # "netlab" honors the configured location (env/Settings UI), not just PATH,
    # so version probes report the same install the CLI actually runs.
    resolved = location.netlab_command() if binary == "netlab" else shutil.which(binary)
    if not resolved or not (os.path.isabs(resolved) or shutil.which(resolved)):
        return None
    with tempfile.TemporaryFile(mode="w+") as stdout_file, tempfile.TemporaryFile(mode="w+") as stderr_file:
        process: subprocess.Popen[str] | None = None
        try:
            process = subprocess.Popen(
                [resolved, *args],
                stdout=stdout_file,
                stderr=stderr_file,
                env=_child_env(),
                text=True,
                start_new_session=True,
            )
            process.wait(timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            if process is not None and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except OSError:
                    with contextlib.suppress(OSError):
                        process.kill()
                with contextlib.suppress(subprocess.SubprocessError):
                    process.wait(timeout=1)
            return None
        stdout_file.seek(0)
        stderr_file.seek(0)
        return stdout_file.read(), stderr_file.read()


def tool_version(binary: str, args: list[str]) -> str | None:
    """Return the first non-empty stdout/stderr line from a local tool version
    command, or None if the tool is unavailable or cannot be queried."""
    result = _tool_output(binary, args)
    if result is None:
        return None
    stdout, stderr = result
    output = stdout or stderr
    return next((line.strip() for line in output.splitlines() if line.strip()), None)


def parse_version_components(output: str) -> list[dict[str, str | bool]]:
    """Parse dependency sections printed by ``netlab version``."""
    section_categories = {
        "Required packages:": "required",
        "Optional packages:": "optional",
        "Ansible components:": "ansible",
    }
    category: str | None = None
    components: list[dict[str, str | bool]] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if line in section_categories:
            category = section_categories[line]
            continue
        if not line:
            category = None
            continue
        if category is None or ":" not in line:
            continue
        name, raw_version = (part.strip() for part in line.split(":", 1))
        installed = raw_version.lower() not in {"not installed", "missing", "none"}
        components.append(
            {
                "name": name,
                "version": raw_version if installed else None,
                "category": category,
                "installed": installed,
            }
        )
    return components


_components_cache: list[dict[str, str | bool]] | None = None


def cached_version_components() -> list[dict[str, str | bool]]:
    """Return structured ``netlab version`` dependency information."""
    global _components_cache
    if _components_cache is not None:
        return _components_cache
    result = _tool_output("netlab", ["version"], timeout=5)
    if result is None:
        _components_cache = []
        return _components_cache
    stdout, stderr = result
    _components_cache = parse_version_components(stdout or stderr)
    return _components_cache


def containerlab_version() -> str | None:
    return tool_version("containerlab", ["version", "--short"])


def libvirt_version() -> str | None:
    return tool_version("virsh", ["--version"])


# Bump this when the backend starts depending on a netlab CLI/library feature
# that only exists in a newer release, so users on an older netlab get a clear
# "upgrade netlab" message instead of a cryptic mid-command failure.
MIN_NETLAB_VERSION = "26.07"

_VERSION_RE = re.compile(r"(\d+)\.(\d+)(?:\.(\d+))?")


def _parse_version(text: str) -> tuple[int, ...] | None:
    match = _VERSION_RE.search(text)
    if not match:
        return None
    return tuple(int(part) for part in match.groups() if part is not None)


def version_at_least(installed: str, minimum: str = MIN_NETLAB_VERSION) -> bool | None:
    """Return whether ``installed`` (raw ``netlab version`` output or a bare
    version string) meets ``minimum``, or None if it could not be parsed."""
    installed_tuple = _parse_version(installed)
    minimum_tuple = _parse_version(minimum)
    if installed_tuple is None or minimum_tuple is None:
        return None
    return installed_tuple >= minimum_tuple


_version_cache: str | bool | None = False  # False = not yet checked, None = checked and unknown


def cached_version() -> str | None:
    """The first line of ``netlab version`` output, cached for the process
    lifetime — health checks poll frequently and the version cannot change
    without restarting this backend."""
    global _version_cache
    if _version_cache is not False:
        return _version_cache
    if not is_installed():
        _version_cache = None
        return None
    _version_cache = tool_version("netlab", ["version"])
    return _version_cache


def reset_version_cache() -> None:
    """Invalidate cached version/components. Call after the netlab location
    changes (Settings UI) so subsequent probes re-run against the new install —
    the version *can* now change without a backend restart."""
    global _version_cache, _components_cache
    _version_cache = False
    _components_cache = None


def connect_argv(node: str) -> list[str]:
    """The argv to open an interactive session to ``node`` (SSH or docker exec —
    netlab decides based on the provider). Used by the PTY/WebSocket shell."""
    _require()
    return [location.netlab_command(), "connect", node]
