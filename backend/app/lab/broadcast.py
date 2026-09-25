"""Run one command on several lab nodes at once, plus saved command scripts.

The web shell (``app/shell/ws.py``) is one interactive PTY per node. This is
the other half of a multi-node shell: fan a single command out to a node
selection in parallel and stream each node's output back as it finishes, so
the UI can show them side by side.

Two modes, both through netlab so every provider works the same way:

* ``shell`` — ``netlab exec <node> …``: a Linux command in the node's
  container (netlab runs it through ``bash -c``, so pipes work) or over SSH
  on VMs.
* ``show`` — ``netlab connect <node> --show …``: a CLI show command in the
  device's own shell (vtysh, Cli, sr_cli, …) — netlab knows which one.

Unlike the assistant's exec tool there is no read-only allowlist: whoever
can reach this endpoint can already open an interactive shell on the node.

Scripts (named command sequences to replay) live next to the topology in
``<topology stem>.netlab-ui-scripts.json`` so they travel with the lab.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.lab import common
from services.netlab import runner

router = APIRouter()

MAX_PARALLEL = 8
# netlab exec/connect always exit 0, whatever the command did. Shell commands
# on container nodes report their real status through this trailer instead.
EXIT_MARKER = "__netlab_ui_exit="
# Device CLIs answer a bad show command with text, not a status: "% Unknown
# command" (FRR, IOS, EOS, NX-OS), "Error:" (SR Linux), "error:" (Junos).
_CLI_ERROR_PREFIXES = ("% ", "error:", "syntax error")
MAX_OUTPUT_CHARS = 256_000
_ALL = "all"


class ExecTarget(BaseModel):
    name: str
    device: str | None = None
    provider: str | None = None
    running: bool = False


class ExecTargets(BaseModel):
    nodes: list[ExecTarget]
    groups: dict[str, list[str]]


ExecMode = Literal["auto", "shell", "show"]


class ExecRequest(BaseModel):
    sessionId: str
    # Node names, group names or "all" (= the running nodes) — expanded
    # against the topology.
    nodes: list[str] = Field(min_length=1)
    command: str = Field(min_length=1, max_length=4000)
    # auto: "show …" goes to the device CLI, anything else to its shell.
    mode: ExecMode = "auto"
    timeoutS: float = Field(default=30.0, gt=0, le=300)


class ScriptStep(BaseModel):
    command: str
    mode: ExecMode = "auto"
    nodes: list[str] = Field(default_factory=list)


class ExecScript(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    steps: list[ScriptStep] = Field(default_factory=list)


class ExecScripts(BaseModel):
    scripts: list[ExecScript]


class ExecScriptsSave(BaseModel):
    sessionId: str
    scripts: list[ExecScript]


def _topology(session_id: str):
    from app.contract import commands

    path = common.session_path(session_id)
    return path, commands.load_topology(path)


def _groups(topo: Any) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for group in topo.groups:
        members = [str(m) for m in (group.members or [])]
        if members:
            groups[group.name] = members
    return groups


def expand_targets(
    requested: list[str], node_names: list[str], groups: dict[str, list[str]], running: set[str] | None = None
) -> list[str]:
    """Resolve node/group names (and "all") to concrete node names, in
    topology order, without duplicates. Unknown names are an error. "all"
    means the running nodes when any are known to run — nobody wants the
    stopped ones to answer with errors."""
    known = set(node_names)
    wanted: set[str] = set()

    def add(name: str, seen: frozenset[str]) -> None:
        if name == _ALL:
            wanted.update(running or node_names)
        elif name in known:
            wanted.add(name)
        elif name in groups:
            if name not in seen:
                for member in groups[name]:
                    add(member, seen | {name})
        else:
            raise HTTPException(400, f"{name!r} is neither a node nor a group of this lab")

    for name in requested:
        add(name.strip(), frozenset())
    return [name for name in node_names if name in wanted]


# Devices whose shell is the only interface — "show …" means nothing there.
HOST_DEVICES = {"linux", "none"}


def resolve_mode(mode: str, command: str, device: str | None) -> tuple[str, str]:
    """(mode, command) actually run on a node. netlab's --show adds "show"
    itself, so a typed "show ip route" loses its first word there; in auto
    mode that prefix is what sends a command to the device CLI."""
    text = command.strip()
    has_show = text.lower().startswith("show ")
    if mode == "show":
        return "show", text[5:].strip() if has_show else text
    if mode == "auto" and has_show and (device or "") not in HOST_DEVICES:
        return "show", text[5:].strip()
    return "shell", text


def exec_args(node: str, command: str, mode: str, provider: str | None) -> list[str]:
    """netlab joins the words after the node name with spaces and hands them
    to the node's shell (``bash -c`` on containers, SSH elsewhere), so the
    command goes in as plain whitespace-separated words — quotes and pipes
    reach that shell untouched."""
    if mode == "show":
        return ["connect", "-q", node, "--show", *command.split()]
    if provider == "clab":
        # Subshell, so an `exit` in the command still reaches the trailer.
        command = f"( {command} ); printf '\\n{EXIT_MARKER}%d\\n' $?"
    return ["exec", "-q", node, *command.split()]


async def _status_nodes(path: str) -> dict[str, dict[str, Any]]:
    try:
        status = await runner.status_for(path)
    except (runner.NetlabError, runner.NetlabNotInstalled):
        return {}
    nodes = status.get("nodes") if isinstance(status, dict) else None
    return nodes if isinstance(nodes, dict) else {}


def _is_running(info: dict[str, Any] | None) -> bool:
    return isinstance(info, dict) and str(info.get("status", "")).lower().startswith(("running", "up"))


@router.get("/exec/targets", response_model=ExecTargets)
async def exec_targets(sessionId: str):
    """Nodes (with running state) and groups a command can be sent to."""
    path, topo = _topology(sessionId)
    status = await _status_nodes(path)
    default_device = topo.default("device")
    nodes = [
        ExecTarget(
            name=node.name,
            device=node.device or default_device,
            provider=(status.get(node.name) or {}).get("provider"),
            running=_is_running(status.get(node.name)),
        )
        for node in topo.nodes
    ]
    return ExecTargets(nodes=nodes, groups=_groups(topo))


def _kill(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        return
    with contextlib.suppress(ProcessLookupError):
        proc.kill()


def split_exit_marker(output: str) -> tuple[str, int | None]:
    """Strip the exit-status trailer; ``None`` when the command didn't report one."""
    head, sep, tail = output.rpartition(EXIT_MARKER)
    if not sep:
        return output, None
    try:
        code = int(tail.strip())
    except ValueError:
        return output, None
    return head[:-1] if head.endswith("\n") else head, code


def looks_like_cli_error(output: str) -> bool:
    first = next((line.strip().lower() for line in output.splitlines() if line.strip()), "")
    return first.startswith(_CLI_ERROR_PREFIXES)


def _clip(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + f"\n…[truncated, {len(text) - MAX_OUTPUT_CHARS} more characters]"


async def _run_one(
    node: str, body: ExecRequest, target: tuple[str | None, str | None], cwd: Path, limiter: asyncio.Semaphore
) -> dict[str, Any]:
    provider, device = target
    started = time.monotonic()
    mode, command = resolve_mode(body.mode, body.command, device)
    result: dict[str, Any] = {"node": node, "command": body.command, "mode": mode}
    args = exec_args(node, command, mode, provider)
    async with limiter:
        proc = await runner.spawn_command(args, cwd=cwd)
        timed_out = False
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=body.timeoutS)
        except TimeoutError:
            _kill(proc)
            out, err = await proc.communicate()
            timed_out = True
    output, exit_code = split_exit_marker(out.decode(errors="replace"))
    if exit_code is None and not timed_out and proc.returncode:
        exit_code = proc.returncode  # netlab itself failed (node down, unknown node, …)
    failed = timed_out or bool(exit_code) or (mode == "show" and looks_like_cli_error(output))
    result.update(
        exitCode=exit_code,
        timedOut=timed_out,
        failed=failed,
        output=_clip(output),
        stderr=_clip(err.decode(errors="replace")),
        durationMs=round((time.monotonic() - started) * 1000),
    )
    return result


@router.post("/exec/stream")
async def exec_stream(body: ExecRequest):
    """Run ``command`` on every selected node in parallel (at most
    ``MAX_PARALLEL`` at a time). SSE frames: ``{targets: [...]}`` first, one
    ``{result: {...}}`` per node as it finishes, then ``{done: true}``."""
    path, topo = _topology(body.sessionId)
    if not runner.is_installed():
        raise HTTPException(503, "netlab is not installed")
    status = await _status_nodes(path)
    running = {name for name, info in status.items() if _is_running(info)}
    targets = expand_targets(body.nodes, [n.name for n in topo.nodes], _groups(topo), running)
    if not targets:
        raise HTTPException(400, "no nodes selected")
    default_device = topo.default("device")
    devices = {n.name: n.device or default_device for n in topo.nodes}
    cwd = Path(path).parent
    limiter = asyncio.Semaphore(MAX_PARALLEL)

    async def gen():
        yield f"data: {json.dumps({'targets': targets})}\n\n"
        tasks = [
            asyncio.create_task(
                _run_one(node, body, ((status.get(node) or {}).get("provider"), devices.get(node)), cwd, limiter)
            )
            for node in targets
        ]
        try:
            for finished in asyncio.as_completed(tasks):
                yield f"data: {json.dumps({'result': await finished})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        finally:
            for task in tasks:
                task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream", headers=common.SSE_HEADERS)


def scripts_path(topology_path: str | Path) -> Path:
    path = Path(topology_path)
    return path.with_name(f"{path.stem}.netlab-ui-scripts.json")


@router.get("/exec/scripts", response_model=ExecScripts)
def get_scripts(sessionId: str):
    target = scripts_path(common.session_path(sessionId))
    try:
        data = json.loads(target.read_text())
        return ExecScripts.model_validate(data)
    except (OSError, ValueError):
        return ExecScripts(scripts=[])


@router.put("/exec/scripts", response_model=ExecScripts)
def put_scripts(body: ExecScriptsSave):
    target = scripts_path(common.session_path(body.sessionId))
    value = ExecScripts(scripts=body.scripts)
    if not value.scripts:
        target.unlink(missing_ok=True)
        return value
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(value.model_dump(), indent=2) + "\n")
    temporary.replace(target)
    return value
