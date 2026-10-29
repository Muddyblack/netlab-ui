"""Preflight checks for running labs from this host (the native-install counterpart of ``container_env``).

Deploying fails late and cryptically when the host is not set up: a missing netlab, no Docker access, containerlab
asking for a sudo password the app cannot type. :func:`diagnose` reports each of these up front, with the fix, so
the setup wizard (and a deploy attempt) can explain the problem before anything runs.

Inside a container the checks of ``container_env`` apply instead, so :func:`diagnose` returns no checks there,
unless netlab runs on the host (``location.on_host``): then the host user's containerlab and Docker access are checked.
"""

from __future__ import annotations

import grp
import os
import shutil
import stat
import subprocess
import time
from pathlib import Path
from typing import Any

from netlab_ui.services import container_env, host, workspaces
from netlab_ui.services.netlab import location, runner

# Deploying needs root, and the app has no terminal to type a sudo password into. Passwordless sudo is not the answer:
# containerlab's own model is a root-owned setuid binary that only members of the clab_admins group may run.
SUDO_HINT = (
    "Deploying needs root, and this app cannot type a sudo password. Give containerlab the setup its installer uses: "
    "a root-owned setuid binary that only the clab_admins group can run, with you in that group. "
    "Ubuntu/Debian: install containerlab from its package or install script, then `sudo usermod -aG clab_admins $USER` "
    "and log in again. NixOS: add a security.wrappers.containerlab entry (owner root, group clab_admins, "
    "setuid = true, permissions u+rx,g+x,o=) and put your user in the clab_admins group, then rebuild."
)

_CACHE_TTL = 30.0
_cache: tuple[float, dict[str, Any]] | None = None
_DOCKER_SOCKET = Path("/var/run/docker.sock")


def _check(check_id: str, ok: bool, severity: str, title: str, detail: str, fix: str | None = None) -> dict[str, Any]:
    return {"id": check_id, "ok": ok, "severity": severity, "title": title, "detail": detail, "fix": fix}


def _netlab_check() -> dict[str, Any]:
    if not runner.is_installed():
        return _check(
            "netlab",
            False,
            "error",
            "netlab not found",
            "The netlab CLI drives every lab operation.",
            "pipx install 'networklab>="
            + runner.MIN_NETLAB_VERSION
            + "' (or point Settings → Environment at an install)",
        )
    version = (runner.cached_version() or "").removeprefix("netlab version").strip()
    if version and runner.version_at_least(version):
        return _check("netlab", True, "error", f"netlab {version}", "Installed and new enough.")
    return _check(
        "netlab",
        False,
        "error",
        f"netlab {version or '(unknown version)'} is older than {runner.MIN_NETLAB_VERSION}",
        "This UI relies on features from newer netlab releases.",
        "pipx upgrade networklab",
    )


def _containerlab_check() -> list[dict[str, Any]]:
    path = shutil.which("containerlab")
    if not path:
        return [
            _check(
                "containerlab",
                False,
                "error",
                "containerlab not found",
                "netlab deploys the clab provider's labs through containerlab.",
                "https://containerlab.dev/install/",
            )
        ]
    checks = [_check("containerlab", True, "error", "containerlab found", path)]
    checks.append(_privilege_check(path))
    return checks


def deploy_warning() -> str | None:
    """A line to show before a deploy when containerlab is not set up to run without a password, else None.

    Only warns: a lab on another provider, or a setup this check does not understand, may still deploy."""
    result = diagnose()
    for check in result["checks"]:
        if check["id"] == "clab-privileges" and not check["ok"]:
            return f"Warning: {check['title']}. {check['fix'] or check['detail']}"
    return None


def _privilege_check(path: str) -> dict[str, Any]:
    """Can this process run containerlab as root without a password prompt?"""
    if os.geteuid() == 0:
        return _check("clab-privileges", True, "error", "Running as root", "containerlab needs no further setup.")
    try:
        info = Path(path).resolve().stat()
    except OSError:
        return _privilege_verdict(None, set())
    try:
        group = grp.getgrgid(info.st_gid).gr_name
    except KeyError:
        group = str(info.st_gid)
    return _privilege_verdict((info.st_uid, info.st_gid, info.st_mode, group), {*os.getgroups(), os.getegid()})


def _privilege_verdict(binary: tuple[int, int, int, str] | None, groups: set[int]) -> dict[str, Any]:
    """The check for containerlab's ``(owner uid, group id, mode, group name)`` and the user's group ids."""
    if binary is None or not (binary[0] == 0 and binary[2] & stat.S_ISUID):
        return _check(
            "clab-privileges",
            False,
            "error",
            "containerlab is not set up for sudo-less use",
            "netlab runs containerlab without sudo, which needs the setuid binary and clab_admins group.",
            SUDO_HINT,
        )
    _uid, gid, mode, group = binary
    # Setuid root. Group-restricted installs (mode u+rx,g+x,o=) only run for members of the file's group.
    if not mode & stat.S_IXOTH and gid not in groups:
        return _check(
            "clab-privileges",
            False,
            "error",
            f"You are not in the {group} group",
            f"containerlab is restricted to members of {group}. Group changes apply after logging in again "
            "(and restarting the netlab-ui service).",
            f"sudo usermod -aG {group} $USER",
        )
    return _check("clab-privileges", True, "error", "containerlab runs without sudo", "Setuid binary, group access ok.")


# What the containerlab and Docker checks need to know about the host user, asked on the host.
_HOST_FACTS = """
s=/var/run/docker.sock; if [ -r "$s" ] && [ -w "$s" ]; then echo docker=ok; else echo docker=no; fi
echo "groups=$(id -G)"
p=$(command -v containerlab) || exit 0
echo "clab=$p"
echo "stat=$(stat -L -c '%u %g %f' "$p")"
echo "group=$(getent group "$(stat -L -c %g "$p")" | cut -d: -f1)"
"""


def _host_checks() -> list[dict[str, Any]]:
    """containerlab and Docker as the host user sees them, for netlab running on the host (``location.on_host``)."""
    argv, env = host.command(["sh", "-c", _HOST_FACTS], {})
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=15, env=env).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        return [_check("host", False, "error", "Could not check the host", str(exc))]
    facts = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    user = host.user().name
    docker = (
        _check("docker", True, "error", "Docker socket accessible", f"{_DOCKER_SOCKET} on the host, as {user}")
        if facts.get("docker") == "ok"
        else _check(
            "docker",
            False,
            "error",
            "No access to the Docker socket",
            f"{user} cannot read and write {_DOCKER_SOCKET} on the host; netlab runs there as {user}.",
            f"sudo usermod -aG docker {user}, then restart the container",
        )
    )
    path = facts.get("clab")
    if not path:
        missing = _check(
            "containerlab",
            False,
            "error",
            "containerlab not found on the host",
            "netlab deploys the clab provider's labs through containerlab.",
            "https://containerlab.dev/install/",
        )
        return [missing, docker]
    try:
        uid, gid, mode_hex = facts.get("stat", "").split()
        binary = (int(uid), int(gid), int(mode_hex, 16), facts.get("group") or gid)
    except ValueError:
        binary = None
    groups = {int(g) for g in facts.get("groups", "").split() if g.isdigit()}
    found = _check("containerlab", True, "error", "containerlab found", f"{path} on the host")
    return [found, _privilege_verdict(binary, groups), docker]


def _docker_check() -> dict[str, Any]:
    if os.environ.get("DOCKER_HOST"):
        return _check("docker", True, "error", "Docker via DOCKER_HOST", os.environ["DOCKER_HOST"])
    if not _DOCKER_SOCKET.exists():
        return _check(
            "docker",
            False,
            "error",
            "Docker daemon not found",
            f"{_DOCKER_SOCKET} does not exist; containerlab starts lab nodes as containers.",
            "Install and start Docker (or Podman with its Docker-compatible socket).",
        )
    if not os.access(_DOCKER_SOCKET, os.R_OK | os.W_OK):
        return _check(
            "docker",
            False,
            "error",
            "No access to the Docker socket",
            f"{_DOCKER_SOCKET} is not readable and writable by this user.",
            "sudo usermod -aG docker $USER, then log in again",
        )
    return _check("docker", True, "error", "Docker socket accessible", str(_DOCKER_SOCKET))


def _netem_check() -> dict[str, Any]:
    loaded = Path("/sys/module/sch_netem").exists()
    return _check(
        "sch-netem",
        loaded,
        "warning",
        "sch_netem loaded" if loaded else "sch_netem kernel module not loaded",
        "Link delay, loss and jitter impairments use it."
        if loaded
        else "Link impairments will fail until it is loaded.",
        None if loaded else "sudo modprobe sch_netem",
    )


def _workspace_checks() -> list[dict[str, Any]]:
    checks = []
    for ws in workspaces.load():
        path = Path(ws)
        # The folder may not exist yet; what matters is that the nearest existing parent can be written.
        probe = path
        while not probe.exists() and probe != probe.parent:
            probe = probe.parent
        ok = os.access(probe, os.W_OK | os.X_OK)
        checks.append(
            _check(
                f"workspace:{ws}",
                ok,
                "error",
                f"Workspace {ws} is writable" if ok else f"Workspace {ws} is not writable",
                "Labs are saved here." if ok else f"{probe} cannot be written by this user.",
                None if ok else f"chown -R $USER {probe}",
            )
        )
    return checks


def diagnose(*, refresh: bool = False) -> dict[str, Any]:
    """Host setup checks (cached for a short while)."""
    global _cache
    if not refresh and _cache and time.monotonic() - _cache[0] < _CACHE_TTL:
        return _cache[1]
    if location.on_host():
        # A container running the host's netlab: these checks are about the host, so they apply after all.
        checks = [_netlab_check(), *_host_checks(), _netem_check()]
        result: dict[str, Any] = {
            "inContainer": False,
            "ready": all(c["ok"] for c in checks if c["severity"] == "error"),
            "checks": checks,
        }
    elif container_env.in_container():
        result = {"inContainer": True, "ready": True, "checks": []}
    else:
        checks = [_netlab_check(), *_containerlab_check(), _docker_check(), _netem_check(), *_workspace_checks()]
        result = {
            "inContainer": False,
            "ready": all(c["ok"] for c in checks if c["severity"] == "error"),
            "checks": checks,
        }
    _cache = (time.monotonic(), result)
    return result
