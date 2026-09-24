"""Self-diagnostics for the containerized UI.

When the backend runs inside a container it drives the *host's* Docker daemon
(through the mounted socket), so a handful of ``docker run`` choices decide
whether labs can deploy at all. Each one fails late and cryptically — a
containerlab bind-mount error, an ``rp_filter`` "read-only file system", labs
that vanish from ``netlab status`` after a restart — so the backend inspects
its own container once and reports what is wrong and how to fix it.

Nothing here runs outside a container: :func:`diagnose` returns
``inContainer: False`` and no checks.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

from services import workspaces

_CACHE_TTL = 30.0
_cache: tuple[float, dict[str, Any]] | None = None


def in_container() -> bool:
    if os.environ.get("NETLAB_GUI_IN_CONTAINER", "").strip().lower() in {"1", "true", "yes"}:
        return True
    if Path("/.dockerenv").exists() or Path("/run/.containerenv").exists():
        return True
    try:
        cgroup = Path("/proc/1/cgroup").read_text(errors="replace")
    except OSError:
        return False
    return any(marker in cgroup for marker in ("docker", "containerd", "kubepods", "libpod"))


def _inspect_self() -> dict[str, Any] | None:
    """``docker inspect`` of this container, or ``None`` if it can't be read
    (no socket, no CLI, or a hostname that isn't the container id)."""
    docker = shutil.which("docker")
    if not docker:
        return None
    candidates = [os.environ.get("NETLAB_GUI_CONTAINER", "").strip(), socket.gethostname()]
    for name in filter(None, candidates):
        try:
            proc = subprocess.run(
                [docker, "inspect", name],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if proc.returncode != 0:
            continue
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
    return None


def _mount_for(path: str, mounts: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The mount whose destination most specifically contains ``path``."""
    best: dict[str, Any] | None = None
    for mount in mounts:
        dest = str(mount.get("Destination") or "").rstrip("/") or "/"
        contains = path == dest or path.startswith(dest + "/") or dest == "/"
        if contains and (best is None or len(dest) > len(str(best.get("Destination") or ""))):
            best = mount
    return best


def _check(check_id: str, ok: bool, severity: str, title: str, detail: str, fix: str | None = None) -> dict[str, Any]:
    return {"id": check_id, "ok": ok, "severity": severity, "title": title, "detail": detail, "fix": fix}


def _workspace_checks(mounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checks = []
    for ws in workspaces.load():
        mount = _mount_for(ws, mounts)
        if mount is None or mount.get("Type") not in {"bind", "volume"}:
            checks.append(
                _check(
                    f"workspace:{ws}",
                    False,
                    "error",
                    f"Workspace {ws} is not mounted from the host",
                    "Labs saved here live only inside this container and are lost when it is removed. "
                    "containerlab also cannot bind-mount node files from it, so deployments fail.",
                    f"-v {ws}:{ws}",
                )
            )
            continue
        if mount.get("Type") == "volume":
            checks.append(
                _check(
                    f"workspace:{ws}",
                    False,
                    "error",
                    f"Workspace {ws} is a Docker volume",
                    "containerlab asks the host Docker daemon to bind-mount node config files by their path "
                    "inside this workspace. A named volume has no such host path, so node startup fails.",
                    f"Bind-mount a host directory at the same path: -v /path/on/host:{ws} -e NETLAB_WORKSPACE={ws}",
                )
            )
            continue
        dest = str(mount.get("Destination") or "").rstrip("/")
        source = str(mount.get("Source") or "").rstrip("/")
        host_path = source + ws[len(dest) :] if dest else ws
        same = host_path == ws
        checks.append(
            _check(
                f"workspace:{ws}",
                same,
                "error",
                f"Workspace {ws} is mounted at the same path on the host"
                if same
                else f"Workspace {ws} has a different path on the host",
                (
                    "containerlab bind mounts resolve on the host."
                    if same
                    else f"It is {host_path} on the host. containerlab asks the host Docker daemon to "
                    f"bind-mount node files by their in-container path ({ws}/…), which does not exist "
                    "on the host, so nodes fail to start."
                ),
                None if same else f"-v {host_path}:{host_path} -e NETLAB_WORKSPACE={host_path}",
            )
        )
    return checks


def _state_check(mounts: list[dict[str, Any]]) -> dict[str, Any]:
    netlab_home = str(Path("~/.netlab").expanduser())
    mount = _mount_for(netlab_home, mounts)
    persisted = mount is not None and str(mount.get("Destination") or "") not in {"", "/"}
    return _check(
        "netlab-state",
        persisted,
        "warning",
        "netlab lab registry is persisted" if persisted else "netlab lab registry lives only in this container",
        (
            f"{netlab_home} (running-lab registry, icons, user plugins) survives container restarts."
            if persisted
            else f"{netlab_home} holds netlab's running-lab registry. Labs started from the UI are invisible to "
            "`netlab status` on the host and become orphans when this container is recreated."
        ),
        None if persisted else f"-v $HOME/.netlab:{netlab_home}",
    )


def _host_config_checks(info: dict[str, Any]) -> list[dict[str, Any]]:
    host_config = info.get("HostConfig") or {}
    privileged = bool(host_config.get("Privileged"))
    network = str(host_config.get("NetworkMode") or "")
    pid = str(host_config.get("PidMode") or "")
    return [
        _check(
            "privileged",
            privileged,
            "error",
            "Running privileged" if privileged else "Container is not privileged",
            (
                "containerlab can create network namespaces and veth links."
                if privileged
                else "containerlab needs to create namespaces, veth pairs and set sysctls; deploys fail with "
                "'read-only file system' or permission errors."
            ),
            None if privileged else "--privileged",
        ),
        _check(
            "host-network",
            network == "host",
            "warning",
            "Using the host network" if network == "host" else f"Network mode is {network or 'default'}",
            (
                "Node management IPs are reachable for SSH, web UIs and packet capture."
                if network == "host"
                else "The lab management network lives on the host; SSH/Telnet/web access to node management "
                "IPs from this container will not work."
            ),
            None if network == "host" else "--network host",
        ),
        _check(
            "host-pid",
            pid == "host",
            "warning",
            "Sharing the host PID namespace" if pid == "host" else "Not sharing the host PID namespace",
            (
                "containerlab can reach container network namespaces."
                if pid == "host"
                else "containerlab resolves node network namespaces through host PIDs; link wiring and "
                "impairments can fail without it."
            ),
            None if pid == "host" else "--pid host",
        ),
    ]


def diagnose(*, refresh: bool = False) -> dict[str, Any]:
    """Container deployment checks (cached for a short while)."""
    global _cache
    if not refresh and _cache and time.monotonic() - _cache[0] < _CACHE_TTL:
        return _cache[1]

    if not in_container():
        result: dict[str, Any] = {"inContainer": False, "inspected": False, "checks": []}
    else:
        docker_socket = Path("/var/run/docker.sock").exists()
        checks = [
            _check(
                "docker-socket",
                docker_socket,
                "error",
                "Docker socket mounted" if docker_socket else "Docker socket is not mounted",
                (
                    "Labs run on the host's Docker daemon."
                    if docker_socket
                    else "Without the host Docker socket the UI cannot deploy labs, list containers or open shells."
                ),
                None if docker_socket else "-v /var/run/docker.sock:/var/run/docker.sock",
            )
        ]
        info = _inspect_self() if docker_socket else None
        if info is not None:
            mounts = [m for m in (info.get("Mounts") or []) if isinstance(m, dict)]
            checks += _host_config_checks(info)
            checks += _workspace_checks(mounts)
            checks.append(_state_check(mounts))
        result = {"inContainer": True, "inspected": info is not None, "checks": checks}

    _cache = (time.monotonic(), result)
    return result
