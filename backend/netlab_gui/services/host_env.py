"""Preflight checks for running labs from this host (the native-install counterpart of ``container_env``).

Deploying fails late and cryptically when the host is not set up: a missing netlab, no Docker access, containerlab
asking for a sudo password the app cannot type. :func:`diagnose` reports each of these up front, with the fix, so
the setup wizard (and a deploy attempt) can explain the problem before anything runs.

Inside a container the checks of ``container_env`` apply instead, so :func:`diagnose` returns no checks there.
"""

from __future__ import annotations

import grp
import os
import shutil
import stat
import time
from pathlib import Path
from typing import Any

from netlab_gui.services import container_env, workspaces
from netlab_gui.services.netlab import runner

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


def _privilege_check(path: str) -> dict[str, Any]:
    """Can this process run containerlab as root without a password prompt?"""
    if os.geteuid() == 0:
        return _check("clab-privileges", True, "error", "Running as root", "containerlab needs no further setup.")
    try:
        info = Path(path).resolve().stat()
    except OSError:
        info = None
    if info is None or not (info.st_uid == 0 and info.st_mode & stat.S_ISUID):
        return _check(
            "clab-privileges",
            False,
            "error",
            "containerlab is not set up for sudo-less use",
            "netlab would call `sudo containerlab`, which asks for a password the app cannot enter.",
            SUDO_HINT,
        )
    # Setuid root. Group-restricted installs (mode u+rx,g+x,o=) only run for members of the file's group.
    if not info.st_mode & stat.S_IXOTH:
        try:
            group = grp.getgrgid(info.st_gid).gr_name
        except KeyError:
            group = str(info.st_gid)
        if info.st_gid not in os.getgroups() and info.st_gid != os.getegid():
            return _check(
                "clab-privileges",
                False,
                "error",
                f"You are not in the {group} group",
                f"containerlab is restricted to members of {group}. Group changes apply after logging in again "
                "(and restarting the netlab-gui service).",
                f"sudo usermod -aG {group} $USER",
            )
    return _check("clab-privileges", True, "error", "containerlab runs without sudo", "Setuid binary, group access ok.")


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
    if container_env.in_container():
        result: dict[str, Any] = {"inContainer": True, "ready": True, "checks": []}
    else:
        checks = [_netlab_check(), *_containerlab_check(), _docker_check(), _netem_check(), *_workspace_checks()]
        result = {
            "inContainer": False,
            "ready": all(c["ok"] for c in checks if c["severity"] == "error"),
            "checks": checks,
        }
    _cache = (time.monotonic(), result)
    return result
