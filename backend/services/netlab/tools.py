"""netlab's external tools (``tools:`` in a topology): Graphite, SuzieQ, NUTS,
Cisco NSO, Edgeshark, …

netlab defines each tool in ``netsim/tools/<tool>.yml``: shell commands to
start (``up``), stop (``down``) and connect to it, plus a message telling the
user where to find it. ``netlab up`` starts every tool listed in the lab's
``tools:`` after the lab is up; ``netlab down`` stops them.

This module offers the same through the UI:

* the catalog of tools this netlab knows (read from its tool definitions);
* turning a tool on or off for a lab (edits ``tools:`` — takes effect on the
  next deploy, when netlab also renders the tool's config files);
* for tools of a deployed lab: running state, their URLs, start/stop now.

Commands are rendered and run by netlab's own code in netlab's Python
(:mod:`services.netlab._tools_bridge`), from the deployed snapshot, so what
runs is exactly what ``netlab up`` would run.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from services.netlab import location, runner

BRIDGE = Path(__file__).with_name("_tools_bridge.py")
SNAPSHOT = "netlab.snapshot.pickle"
# The UI itself is a netlab tool (tools/netlab_ui.yml) — you're already in it.
HIDDEN = {"netlab_ui"}

ABOUT = {
    "graphite": ("Graphite", "Interactive topology graph in the browser, laid out from the lab."),
    "suzieq": ("SuzieQ", "Network observability: polls every device; query the state with the SuzieQ CLI."),
    "nuts": ("NUTS", "Network unit tests (pytest) with generated interface, OSPF and BGP tests."),
    "nso": ("Cisco NSO", "Cisco Network Services Orchestrator with the lab devices (needs the cisco-nso-prod image)."),
    "edgeshark": ("Edgeshark", "Browse the host's containers and interfaces and capture into Wireshark."),
}
DOCS = "https://netlab.tools/extools/"
_URL_RE = re.compile(r"https?://[^\s'\"<>]+")
# docker pull progress ("de611ff764da: Pull complete") says nothing useful.
_PULL_PROGRESS_RE = re.compile(r"^[0-9a-f]{12}: |^\S+: Pulling from ")


def _clean(output: str) -> str:
    return "\n".join(line for line in output.splitlines() if not _PULL_PROGRESS_RE.match(line))


def _definitions_dir() -> Path | None:
    package = location.netsim_package_dir()
    directory = package / "tools" if package else None
    return directory if directory and directory.is_dir() else None


def _header_comment(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if not line.startswith("#"):
            break
        body = line.lstrip("#").strip()
        if body and not body.lower().startswith("http") and "yamllint" not in body:
            lines.append(body)
    return " ".join(lines)


def catalog() -> list[dict[str, Any]]:
    """Every tool this netlab defines, in a stable order."""
    directory = _definitions_dir()
    if directory is None:
        return []
    yaml = YAML(typ="safe")
    result = []
    for path in sorted(directory.glob("*.yml")):
        tool = path.stem
        if tool in HIDDEN:
            continue
        try:
            text = path.read_text()
            data = yaml.load(text) or {}
        except (OSError, ValueError):
            continue
        runtime = str(data.get("runtime") or "docker")
        commands = data.get(runtime) if isinstance(data.get(runtime), dict) else {}
        title, description = ABOUT.get(tool, (tool, _header_comment(text)))
        result.append(
            {
                "id": tool,
                "title": title,
                "description": description,
                "runtime": runtime,
                "canConnect": bool(commands.get("connect")),
                "docsUrl": f"{DOCS}#{tool}",
            }
        )
    return result


def enabled(attrs: dict[str, Any]) -> list[str]:
    tools = attrs.get("tools")
    return [str(name) for name in tools] if isinstance(tools, dict) else []


def set_enabled(attrs: dict[str, Any], tool: str, on: bool) -> None:
    """Add or remove ``tool`` under ``tools:``; keeps its settings when present."""
    tools = attrs.get("tools") if isinstance(attrs.get("tools"), dict) else {}
    if on:
        tools.setdefault(tool, None)
    else:
        tools.pop(tool, None)
    if tools:
        attrs["tools"] = tools
    else:
        attrs.pop("tools", None)


def is_deployed(lab_dir: Path) -> bool:
    return (lab_dir / SNAPSHOT).is_file()


async def _bridge(lab_dir: Path, *args: str, timeout: float = 20) -> tuple[int, dict[str, Any]]:
    python = location.target_python()
    if not python:
        return 127, {"ok": False, "output": "netlab is not installed"}
    proc = await asyncio.create_subprocess_exec(
        python,
        str(BRIDGE),
        *args,
        cwd=str(lab_dir),
        env=runner._child_env(lab_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, {"ok": False, "output": f"netlab took longer than {timeout:.0f} s"}
    try:
        data = json.loads(out.decode().strip().splitlines()[-1])
    except (IndexError, ValueError):
        data = {"ok": False, "output": (err.decode() or out.decode()).strip()[-2000:]}
    return proc.returncode or 0, data if isinstance(data, dict) else {}


async def deployed_tools(lab_dir: Path) -> dict[str, dict[str, Any]]:
    """Tools of the deployed lab with their rendered message and containers."""
    if not is_deployed(lab_dir):
        return {}
    _code, data = await _bridge(lab_dir, "info")
    tools = data.get("tools")
    return tools if isinstance(tools, dict) else {}


async def _running(containers: list[str]) -> bool | None:
    """True when every container of the tool runs; None when unknown."""
    binary = runner.container_runtime_binary()
    if not containers or not binary:
        return None
    proc = await asyncio.create_subprocess_exec(
        binary,
        "inspect",
        "-f",
        "{{.State.Running}}",
        *containers,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    states = out.decode().split()
    return len(states) == len(containers) and all(state == "true" for state in states)


def urls(message: str) -> list[str]:
    return list(dict.fromkeys(url.rstrip(".,)") for url in _URL_RE.findall(message or "")))


async def lab_tools(lab_dir: Path, attrs: dict[str, Any]) -> list[dict[str, Any]]:
    """The catalog annotated for one lab: enabled, deployed, running, URLs."""
    wanted = enabled(attrs)
    deployed = await deployed_tools(lab_dir)
    known = {item["id"] for item in catalog()}
    items = catalog() + [
        {"id": tool, "title": tool, "description": "", "runtime": "", "canConnect": False, "docsUrl": DOCS}
        for tool in [*wanted, *deployed]
        if tool not in known and tool not in HIDDEN
    ]
    running = await asyncio.gather(*(_running(list(deployed.get(i["id"], {}).get("containers") or [])) for i in items))
    result = []
    for item, is_running in zip(items, running, strict=True):
        info = deployed.get(item["id"])
        result.append(
            {
                **item,
                "enabled": item["id"] in wanted,
                "deployed": info is not None,
                "running": bool(is_running) if info is not None else False,
                "message": (info or {}).get("message", ""),
                "urls": urls((info or {}).get("message", "")),
                "canConnect": bool((info or {}).get("canConnect", item["canConnect"])),
            }
        )
    return list({item["id"]: item for item in result}.values())


async def action(lab_dir: Path, tool: str, what: str) -> runner.CommandResult:
    """Start (``up``) or stop (``down``) one tool of the deployed lab."""
    if not is_deployed(lab_dir):
        return runner.CommandResult(1, "", "The lab isn't deployed — its tools start with it.")
    code, data = await _bridge(lab_dir, what, tool, timeout=300)
    output = _clean(str(data.get("output") or ""))
    message = str(data.get("message") or "")
    if code or not data.get("ok"):
        return runner.CommandResult(code or 1, "", output or f"Could not {'start' if what == 'up' else 'stop'} {tool}")
    return runner.CommandResult(0, "\n".join(part for part in (output, message) if part), "")
