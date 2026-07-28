"""Read-only command execution on running lab nodes.

The assistant is allowed to *look* at a running lab — routing tables, neighbour
state, reachability — and nothing else. That is enforced here rather than in
the prompt: an allowlist of read-only command prefixes plus a rejection list
for anything that could chain, redirect or configure.

The threat model is not "a malicious user" (they already have a shell button in
the UI); it is "the model was talked into it by something it read", so the
check has to be mechanical and independent of the model's judgement.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shlex
import signal
from pathlib import Path

from services.assistant.config import EXEC_TIMEOUT_S, MAX_CONCURRENT_EXEC, MAX_OUTPUT_BYTES
from services.netlab import runner

# Read-only verbs across the network OSes netlab supports (IOS/NX-OS/EOS/Junos/
# SR Linux/FRR/Cumulus) plus the handful of Linux inspection commands that make
# sense on hosts.
ALLOWED_PREFIXES: tuple[str, ...] = (
    "show ",
    "display ",  # Huawei/VRP
    "get ",  # Fortinet
    "ping ",
    "ping6 ",
    "traceroute ",
    "traceroute6 ",
    "tracepath ",
    "ip ",  # ip route / ip addr / ip -6 …
    "bridge ",
    "ss ",
    "netstat ",
    "arp",
    "cat /etc/",
    "cat /proc/net/",
    "vtysh -c show ",
    "vtysh -c 'show ",
    'vtysh -c "show ',
    "birdc show ",
    "sr_cli show ",
    "hostname",
    "uname",
    "uptime",
)

# Shell metacharacters (chaining, redirection, substitution) and write verbs.
# ``ip`` is allowed above, so its mutating subcommands are caught here.
DENIED_SUBSTRINGS: tuple[str, ...] = (
    ";",
    "|",
    "&",
    ">",
    "<",
    "`",
    "$(",
    "\n",
    "\r",
    "&&",
    "||",
    " configure",
    "config t",
    "conf t",
    "write ",
    "delete ",
    " commit",
    "reload",
    "reboot",
    "shutdown",
    "clear ",
    "debug ",
    "erase",
    "copy ",
    "ip link set",
    "ip addr add",
    "ip addr del",
    "ip route add",
    "ip route del",
    "tc qdisc",
    "sudo",
    "chmod",
    "chown",
    "rm ",
    "mv ",
    "dd ",
)


class CommandRejected(ValueError):
    """Raised when a command fails the read-only allowlist."""


def check_command(command: str) -> list[str]:
    """Validate ``command`` and return it as an argv list.

    Raises :class:`CommandRejected` with an actionable message — the agent sees
    it as a tool error and can rephrase instead of retrying blindly.
    """
    text = command.strip()
    if not text:
        raise CommandRejected("empty command")
    lowered = text.lower()

    for bad in DENIED_SUBSTRINGS:
        if bad in lowered:
            raise CommandRejected(
                f"command rejected: contains {bad!r}. Only single read-only commands are allowed "
                "(no shell operators, no configuration)."
            )
    if not lowered.startswith(ALLOWED_PREFIXES):
        allowed = ", ".join(p.strip() for p in ALLOWED_PREFIXES[:10])
        raise CommandRejected(
            f"command rejected: must start with a read-only verb ({allowed}, …). "
            "To change device state, propose a topology edit instead."
        )

    try:
        argv = shlex.split(text)
    except ValueError as exc:
        raise CommandRejected(f"could not parse command: {exc}") from exc
    if not argv:
        raise CommandRejected("empty command")

    # Unbounded pings never return; bound them so the tool call terminates.
    if argv[0] in {"ping", "ping6"} and not any(a == "-c" for a in argv):
        argv[1:1] = ["-c", "4"]
    if argv[0] in {"traceroute", "traceroute6"} and not any(a == "-w" for a in argv):
        argv[1:1] = ["-w", "1"]
    return argv


_semaphore: asyncio.Semaphore | None = None


def _limiter() -> asyncio.Semaphore:
    # Created lazily: a module-level Semaphore would bind to whichever event
    # loop happened to import this module first.
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXEC)
    return _semaphore


async def exec_on_node(topology_path: str, node: str, command: str) -> dict[str, object]:
    """Run one validated read-only ``command`` on ``node`` via ``netlab exec``."""
    argv = check_command(command)
    path = Path(topology_path)
    args = ["exec", node, *argv]

    async with _limiter():
        proc = await runner.spawn_command(args, cwd=path.parent)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=EXEC_TIMEOUT_S)
        except TimeoutError:
            _kill(proc)
            await proc.wait()
            return {
                "node": node,
                "command": command,
                "timedOut": True,
                "exitCode": None,
                "output": f"command did not finish within {EXEC_TIMEOUT_S:.0f}s and was terminated",
            }

    return {
        "node": node,
        "command": command,
        "timedOut": False,
        "exitCode": proc.returncode or 0,
        "output": _truncate(out.decode(errors="replace")),
        "stderr": _truncate(err.decode(errors="replace")),
    }


def _kill(proc: asyncio.subprocess.Process) -> None:
    """Kill the whole process group (netlab spawns ssh/docker children)."""
    if proc.returncode is not None:
        return
    if os.name == "posix":
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            return
        except (ProcessLookupError, PermissionError, OSError):
            pass
    with contextlib.suppress(ProcessLookupError):
        proc.kill()


def _truncate(text: str, limit: int = MAX_OUTPUT_BYTES) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[truncated, {len(text) - limit} more characters]"
