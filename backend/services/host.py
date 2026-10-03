"""Where the agent CLIs run: this machine, or the host the container sits on.

netlab-ui can run as a container, but the user's AI agents (Claude Code, Codex, ...) live on their
own machine, with their logins and config. The shipped ``docker-compose.yml`` already gives the
container ``privileged: true`` and ``pid: host`` (containerlab needs both), which is enough to step
into the host's namespaces with ``nsenter``. So instead of installing agents in the image, an agent
is started *on the host*, as the host user, in a login shell (so its ``PATH`` is what the user's own
terminal has), and its terminal is streamed back like any other.

Three modes, decided once per minute:

* ``native``: the backend runs on the machine itself; nothing to do.
* ``host``: in a container that may enter the host (see above); agents are found and started there.
* ``container``: in a container that may not; only CLIs inside the container are offered, and
  :func:`note` says why the host is out of reach.

``NETLAB_UI_AGENTS=container`` forces the last one. The host user is the owner of the mounted
``~/.netlab`` (override: ``NETLAB_UI_HOST_UID``); ``NETLAB_UI_HOST_PATH`` adds directories to the
agents' ``PATH`` for shells that a login shell cannot configure (fish, nu).

This adds no privilege: a container with the Docker socket mounted is root on the host already.
Who may start an agent is decided elsewhere (loopback, or a login; see ``app.auth.local_process_allowed``).
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Mode = Literal["native", "host", "container"]

NSENTER = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--"]
# Searched for nsenter's own children in the host's file system (NixOS keeps its tools elsewhere).
HOST_PATH = "/run/current-system/sw/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# Login shells whose `-l -c '<posix script>'` we can rely on; anything else falls back to /bin/sh.
_POSIX_SHELLS = {"bash", "zsh", "sh", "dash", "ksh"}
_MOUNTED_NETLAB_DIR = Path.home() / ".netlab"
_TTL = 60.0


@dataclass(frozen=True)
class HostUser:
    name: str
    uid: int
    gid: int
    home: str
    shell: str


@dataclass(frozen=True)
class _Probe:
    user: HostUser | None
    reason: str  # empty when the host is reachable
    has_script: bool = False  # util-linux `script` on the host: gives the agent a terminal of its own there


_probe_cache: tuple[float, _Probe] | None = None
_which_cache: dict[str, tuple[float, str | None]] = {}


def in_container() -> bool:
    return os.environ.get("NETLAB_GUI_IN_CONTAINER") == "1"


def _run_on_host(argv: list[str], timeout: float = 15.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [*NSENTER, *argv],
        env={"PATH": HOST_PATH},
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _find_user() -> tuple[HostUser | None, str]:
    raw = os.environ.get("NETLAB_UI_HOST_UID", "").strip()
    try:
        uid = int(raw) if raw else _MOUNTED_NETLAB_DIR.stat().st_uid
    except (OSError, ValueError):
        return None, "mount your ~/.netlab into the container (the compose file does), or set NETLAB_UI_HOST_UID"
    done = _run_on_host(["getent", "passwd", str(uid)])
    fields = done.stdout.strip().split(":")
    if done.returncode or len(fields) < 7:
        return None, f"no user with uid {uid} on the host (set NETLAB_UI_HOST_UID)"
    return HostUser(fields[0], int(fields[2]), int(fields[3]), fields[5], fields[6] or "/bin/sh"), ""


def _probe() -> _Probe:
    global _probe_cache
    if _probe_cache and time.monotonic() - _probe_cache[0] < _TTL:
        return _probe_cache[1]
    result: _Probe
    if not shutil.which("nsenter"):
        result = _Probe(None, "nsenter is not installed in this image")
    else:
        try:
            if _run_on_host(["true"], timeout=10).returncode:
                result = _Probe(
                    None, "start the container with privileged: true and pid: host (see docker-compose.yml)"
                )
            else:
                user, reason = _find_user()
                has_script = _run_on_host(["sh", "-c", "command -v script"]).returncode == 0
                result = _Probe(user, reason, has_script)
        except (OSError, subprocess.TimeoutExpired) as exc:
            result = _Probe(None, f"could not enter the host: {exc}")
    _probe_cache = (time.monotonic(), result)
    return result


def reset() -> None:
    """Forget what was learned about the host (tests, or after the user changed the setup)."""
    global _probe_cache
    _probe_cache = None
    _which_cache.clear()


def mode() -> Mode:
    if not in_container():
        return "native"
    if os.environ.get("NETLAB_UI_AGENTS", "auto") == "container":
        return "container"
    return "host" if _probe().user is not None else "container"


def note() -> str:
    """Why the host's agents are out of reach, when running in a container that cannot enter it."""
    if not in_container() or os.environ.get("NETLAB_UI_AGENTS", "auto") == "container":
        return ""
    return _probe().reason


def _user() -> HostUser:
    user = _probe().user
    if user is None:
        raise RuntimeError("the host is not reachable from this container")
    return user


# ---------------------------------------------------------------------- running as the host user


def _login_command(script: str, env: dict[str, str]) -> list[str]:
    """argv (for ``nsenter``'s caller) that runs ``script`` as the host user in their login shell.

    Everything is an ``exec`` chain (nsenter, setpriv, env, shell), so a token in ``env`` is in the
    process's environment but not in any long-lived command line."""
    user = _user()
    shell = user.shell if Path(user.shell).name in _POSIX_SHELLS else "/bin/sh"
    extra = os.environ.get("NETLAB_UI_HOST_PATH", "").strip()
    if extra:
        script = f'PATH="$PATH:{extra}"; export PATH; {script}'
    base = {
        "HOME": user.home,
        "USER": user.name,
        "LOGNAME": user.name,
        "SHELL": shell,
        "PATH": HOST_PATH,
        "TERM": "xterm-256color",
        **env,
    }
    pairs = [f"{key}={value}" for key, value in base.items()]
    return [
        *NSENTER,
        "setpriv",
        f"--reuid={user.uid}",
        f"--regid={user.gid}",
        "--init-groups",
        "--",
        "env",
        "-i",
        *pairs,
        shell,
        "-l",
        "-c",
        script,
    ]


def wrap(argv: list[str], env: dict[str, str], cwd: Path) -> tuple[list[str], dict[str, str]]:
    """The ``(argv, env)`` to spawn so that ``argv`` runs where the agents live.

    Native or container mode: unchanged. Host mode: started on the host as the host user, in ``cwd``
    (the lab folder has the same path on both sides, by the compose file's design)."""
    if mode() != "host":
        return argv, env
    command = f"cd {shlex.quote(str(cwd))} && exec " + " ".join(shlex.quote(part) for part in argv)
    if _probe().has_script:
        # The container's pseudo-terminal does not exist in the host's namespace (no tty name, and
        # Ctrl+C would kill the wrapper chain), so the host allocates its own and relays the bytes.
        command = f"exec script -q -e -f -c {shlex.quote(command)} /dev/null"
    # PATH here is only for nsenter's own exec of setpriv in the host's file system.
    return _login_command(command, env), {"PATH": HOST_PATH}


def login_shell() -> str:
    """The shell a plain terminal starts: the host user's own when running in a container that
    reaches the host, otherwise this machine's ($SHELL, bash or sh)."""
    if mode() == "host":
        return _user().shell
    return os.environ.get("SHELL") or shutil.which("bash") or "/bin/sh"


# ---------------------------------------------------------------------- finding the agents


def which_all(binaries: list[str]) -> dict[str, str | None]:
    """Where each CLI is, as the user's own terminal would find it (cached for a minute)."""
    now = time.monotonic()
    if mode() != "host":
        return {name: shutil.which(name) for name in binaries}
    stale = [name for name in binaries if name not in _which_cache or now - _which_cache[name][0] > _TTL]
    if stale:
        script = (
            "for b in " + " ".join(shlex.quote(name) for name in stale) + "; do "
            'p=$(command -v "$b" 2>/dev/null) && printf "%s\\t%s\\n" "$b" "$p"; done; true'
        )
        found: dict[str, str] = {}
        try:
            done = subprocess.run(
                _login_command(script, {}),
                env={"PATH": HOST_PATH},
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
            for line in done.stdout.splitlines():
                name, _, path = line.partition("\t")
                if path.startswith("/"):  # a shell function or alias is not a program to start
                    found[name] = path
        except (OSError, subprocess.TimeoutExpired):
            pass
        for name in stale:
            _which_cache[name] = (now, found.get(name))
    return {name: _which_cache[name][1] for name in binaries}


def which(binary: str) -> str | None:
    return which_all([binary])[binary]


# ---------------------------------------------------------------------- files both sides can see


def shared_dir() -> tuple[Path, Path]:
    """``(where the backend writes, the path the agent is given)`` for small private files.

    Native: a temp directory. Host mode: ``~/.netlab/ui-agents``, which is the same folder on both
    sides (the compose file mounts ``~/.netlab``), so the paths differ only by the home prefix."""
    if mode() != "host":
        import tempfile

        folder = Path(tempfile.gettempdir())
        return folder, folder
    user = _user()
    written = _MOUNTED_NETLAB_DIR / "ui-agents"
    written.mkdir(parents=True, exist_ok=True)
    share(written)
    os.chmod(written, 0o700)
    return written, Path(user.home) / ".netlab" / "ui-agents"


def share(path: Path) -> None:
    """Hand a file the backend (root in the container) created to the host user, who has to read it."""
    if mode() != "host":
        return
    user = _user()
    os.chown(path, user.uid, user.gid)
