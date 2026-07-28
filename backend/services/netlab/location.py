"""Resolve *where* the netlab install lives.

The netlab UI backend ships without netlab/ansible — they are the opt-in
``[netlab]`` extra, not core dependencies. So the backend must be told where to
find netlab, which may be on the system PATH, in a pipx install, or in a
separate virtualenv the backend interpreter knows nothing about.

The backend drives netlab two ways:

* by shelling out to the ``netlab`` CLI (the bulk of features), and
* by importing ``netsim`` in-process (schema, docs, plugin discovery, image
  resolution, status-file edits) — a handful of ``try: import netsim`` sites.

The CLI only needs the binary's path (plus its ``bin/`` on the child ``PATH`` so
netlab's own ansible/containerlab children resolve). The in-process features
need ``netsim`` importable; when netlab lives in a different venv that means
running *that* venv's Python — hence we also resolve a target interpreter here
(see :func:`target_python`) for the out-of-process bridge to use.

Resolution order for the binary:

1. persisted config (the Settings UI) — ``{"netlabBin": "..."}``
2. the ``NETLAB_BIN`` environment variable
3. ``shutil.which("netlab")`` on the backend's PATH
4. the bare name ``"netlab"`` (last-ditch; the spawner surfaces a clear error)
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

CONFIG_ENV = "NETLAB_GUI_CONFIG"
DEFAULT_CONFIG = "~/.netlab_gui.json"
BIN_ENV = "NETLAB_BIN"
_CONFIG_KEY = "netlabBin"


def _config_path() -> Path:
    return Path(os.environ.get(CONFIG_ENV, DEFAULT_CONFIG)).expanduser()


def _load_config() -> dict:
    p = _config_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError, TypeError):
        return {}


def get_configured_bin() -> str | None:
    """The netlab path the user set via the Settings UI, if any."""
    value = _load_config().get(_CONFIG_KEY)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def set_configured_bin(path: str | None) -> None:
    """Persist (or clear) the user-chosen netlab path.

    Writing merges into the shared config file so unrelated keys survive, and
    ``None``/empty clears the override (falling back to env/PATH resolution).
    """
    p = _config_path()
    data = _load_config()
    if path and path.strip():
        data[_CONFIG_KEY] = path.strip()
    else:
        data.pop(_CONFIG_KEY, None)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2))
    with contextlib.suppress(OSError):
        p.chmod(stat.S_IRUSR | stat.S_IWUSR)
    _probe_netsim.cache_clear()


@dataclass(frozen=True)
class Resolution:
    """Where netlab resolved to, and how — for both spawning and the UI."""

    configured: str | None
    """Raw value the user set (Settings UI), before resolution."""
    source: str
    """Which rule won: ``config`` | ``env`` | ``path`` | ``default``."""
    command: str
    """The value passed to the spawner (may be a bare name or a full path)."""
    bin_path: str | None
    """Absolute path to the resolved binary, or ``None`` if not found."""
    found: bool
    bin_dir: str | None
    """``bin/`` directory of the resolved binary, prepended to child PATH."""


def resolve() -> Resolution:
    configured = get_configured_bin()
    env_bin = os.environ.get(BIN_ENV, "").strip() or None

    if configured:
        command, source = configured, "config"
    elif env_bin:
        command, source = env_bin, "env"
    else:
        which = shutil.which("netlab")
        if which:
            command, source = which, "path"
        else:
            command, source = "netlab", "default"

    # A configured/env value may be a bare name, a relative path, or absolute.
    # Normalise to an absolute binary path when we can actually find it.
    bin_path: str | None
    if os.path.sep in command or (os.altsep and os.altsep in command):
        candidate = Path(command).expanduser()
        bin_path = str(candidate) if candidate.exists() else None
    else:
        bin_path = shutil.which(command)

    bin_dir = str(Path(bin_path).parent) if bin_path else None
    return Resolution(
        configured=configured,
        source=source,
        command=str(Path(command).expanduser()) if os.path.sep in command else command,
        bin_path=bin_path,
        found=bin_path is not None,
        bin_dir=bin_dir,
    )


def netlab_command() -> str:
    """The netlab binary/path to hand the process spawner."""
    r = resolve()
    return r.bin_path or r.command


def is_installed() -> bool:
    return resolve().found


def child_path() -> str:
    """``PATH`` for netlab child processes: the resolved binary's ``bin/`` dir
    prepended, so a netlab in its own venv finds *that* venv's ansible-playbook
    and containerlab rather than a different (or missing) copy on the host PATH.
    """
    base = os.environ.get("PATH", "")
    bin_dir = resolve().bin_dir
    if bin_dir and bin_dir not in base.split(os.pathsep):
        return os.pathsep.join([bin_dir, base]) if base else bin_dir
    return base


def target_python() -> str | None:
    """Path to the Python interpreter that can ``import netsim`` for the resolved
    netlab — the interpreter the out-of-process netsim bridge should run.

    netlab is a Python console-script, so its shebang points straight at the
    interpreter of the venv it was installed into. Fall back to a ``python`` next
    to the binary, then this backend's own interpreter (correct when netlab is
    installed in the backend venv — the common Docker case).
    """
    r = resolve()
    if not r.bin_path:
        return sys.executable
    shebang = _read_shebang(Path(r.bin_path))
    if shebang and Path(shebang).name.startswith("python"):
        return shebang
    if r.bin_dir:
        for name in ("python3", "python"):
            sibling = Path(r.bin_dir) / name
            if sibling.exists():
                return str(sibling)
    return sys.executable


def probe_netsim() -> dict[str, str] | None:
    """Inspect netsim with the Python belonging to the selected netlab."""
    python = target_python()
    resolution = resolve()
    if not python or not resolution.found:
        return None
    return _probe_netsim(python, resolution.bin_path or resolution.command)


@lru_cache(maxsize=8)
def _probe_netsim(python: str, _netlab_command: str) -> dict[str, str] | None:
    script = (
        "import json,pathlib,netsim;"
        "print(json.dumps({'packageDir':str(pathlib.Path(netsim.__file__).parent),"
        "'version':str(getattr(netsim,'__version__',''))}))"
    )
    try:
        result = subprocess.run(
            [python, "-c", script],
            capture_output=True,
            text=True,
            timeout=5,
            env={**os.environ, "PATH": child_path()},
        )
        data = json.loads(result.stdout) if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def netsim_package_dir() -> Path | None:
    probe = probe_netsim()
    value = probe.get("packageDir") if probe else None
    path = Path(value) if value else None
    return path if path and path.is_dir() else None


def netsim_version() -> str | None:
    probe = probe_netsim()
    return (probe.get("version") or None) if probe else None


def forget_status_instance(instance_id: str) -> None:
    """Remove an instance from netlab's status store in netlab's own Python."""
    python = target_python()
    if not python or not resolve().found:
        raise RuntimeError("netlab is not installed")
    script = (
        "import sys;"
        "from netsim.utils import read,status;"
        "key=sys.argv[1];"
        "defaults=read.system_defaults();"
        "status.change_status(defaults,lambda states,topology:"
        "(states.pop(key,None),states.pop(int(key),None) if key.isdigit() else None))"
    )
    result = subprocess.run(
        [python, "-c", script, instance_id],
        capture_output=True,
        text=True,
        timeout=10,
        env={**os.environ, "PATH": child_path()},
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise RuntimeError(detail)


def _read_shebang(path: Path) -> str | None:
    try:
        with path.open("rb") as fh:
            first = fh.readline(256)
    except OSError:
        return None
    if not first.startswith(b"#!"):
        return None
    line = first[2:].decode("utf-8", "replace").strip()
    if not line:
        return None
    # Handle `#!/usr/bin/env python3` as well as a direct interpreter path.
    parts = line.split()
    if parts[0].endswith("env") and len(parts) > 1:
        return shutil.which(parts[1]) or parts[1]
    return parts[0]


def environment_info() -> dict:
    """Resolution facts for the Settings UI / Info tab (no subprocess calls —
    the router layers version/provider probes on top)."""
    r = resolve()
    return {
        "configured": r.configured,
        "source": r.source,
        "command": r.command,
        "binPath": r.bin_path,
        "found": r.found,
        "binDir": r.bin_dir,
        "targetPython": target_python(),
        "inBackendVenv": in_backend_venv(),
        "envVar": BIN_ENV,
        "configPath": str(_config_path()),
    }


def in_backend_venv() -> bool:
    """True when the resolved netlab can be imported by *this* process — i.e. the
    in-process ``import netsim`` fast path is available and the subprocess bridge
    is unnecessary. Compares the target interpreter to our own.
    """
    tp = target_python()
    if not tp:
        return False
    try:
        return os.path.samefile(tp, sys.executable)
    except OSError:
        return os.path.realpath(tp) == os.path.realpath(sys.executable)
