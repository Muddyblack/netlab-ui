"""The ``netlab-ui`` config file: where to listen and where the lab tools live.

A service started by systemd does not see the terminal's environment, so settings that matter for it live in a
file instead: ``~/.config/netlab-ui/config.toml`` (or the file named by ``NETLAB_UI_CONFIG_FILE``)::

    [server]
    host = "127.0.0.1"
    port = 8000

    [tools]
    path = ["~/.local/bin"]          # searched for netlab, ansible-playbook and containerlab
    netlab = "~/venvs/netlab/bin/netlab"   # optional: the netlab executable itself

``netlab-ui serve`` applies it. Precedence for each setting: command-line flag, then environment variable
(``UVICORN_HOST``, ``UVICORN_PORT``, ``NETLAB_BIN``), then this file, then the default.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

CONFIG_ENV = "NETLAB_UI_CONFIG_FILE"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
# Directories a normal PATH already has; not worth writing into the file.
SYSTEM_DIRS = {"/usr/bin", "/bin", "/usr/local/bin", "/usr/sbin", "/sbin", "/usr/local/sbin"}


class ConfigError(Exception):
    """The config file exists but cannot be used; the message says what to fix."""


@dataclass
class Settings:
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    path: list[str] = field(default_factory=list)
    netlab: str | None = None
    source: Path | None = None


def default_path(home: Path | None = None) -> Path:
    if override := os.environ.get(CONFIG_ENV, "").strip():
        return Path(override).expanduser()
    base = (
        Path(os.environ["XDG_CONFIG_HOME"]) if os.environ.get("XDG_CONFIG_HOME") else (home or Path.home()) / ".config"
    )
    return base / "netlab-ui" / "config.toml"


def _expand(value: str) -> str:
    return str(Path(value).expanduser())


def load(path: Path | None = None) -> Settings:
    """Settings from the file, or the defaults when there is none."""
    path = path or default_path()
    if not path.is_file():
        return Settings()
    try:
        data = tomllib.loads(path.read_text())
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"{path}: {exc}") from exc

    server = data.get("server", {})
    tools = data.get("tools", {})
    host, port = server.get("host", DEFAULT_HOST), server.get("port", DEFAULT_PORT)
    if not isinstance(host, str) or not host:
        raise ConfigError(f'{path}: [server] host must be an address such as "127.0.0.1"')
    if not isinstance(port, int) or isinstance(port, bool) or not 0 < port < 65536:
        raise ConfigError(f"{path}: [server] port must be a number between 1 and 65535")
    dirs = tools.get("path", [])
    if not isinstance(dirs, list) or not all(isinstance(d, str) for d in dirs):
        raise ConfigError(f"{path}: [tools] path must be a list of directories")
    netlab = tools.get("netlab") or None
    if netlab is not None and not isinstance(netlab, str):
        raise ConfigError(f"{path}: [tools] netlab must be the path to the netlab executable")
    return Settings(
        host=host,
        port=port,
        path=[_expand(d) for d in dirs],
        netlab=_expand(netlab) if netlab else None,
        source=path,
    )


def apply_tools(settings: Settings) -> None:
    """Make the configured tool locations visible to this process (and the netlab it starts)."""
    if settings.path:
        existing = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
        merged = [*settings.path, *(p for p in existing if p not in settings.path)]
        os.environ["PATH"] = os.pathsep.join(merged)
    if settings.netlab and not os.environ.get("NETLAB_BIN", "").strip():
        os.environ["NETLAB_BIN"] = settings.netlab


def template(tool_dirs: list[str]) -> str:
    """A starter config: the defaults, plus the tool directories found when the service was installed."""
    shown = ", ".join(f'"{d}"' for d in tool_dirs)
    return (
        "# netlab-ui settings (read by `netlab-ui serve`; see `netlab-ui config`).\n"
        "# A command-line flag or an environment variable (UVICORN_HOST, UVICORN_PORT, NETLAB_BIN)\n"
        "# wins over this file.\n"
        "\n"
        "[server]\n"
        f'# host = "{DEFAULT_HOST}"   # use "0.0.0.0" only together with a token: netlab-ui token\n'
        f"# port = {DEFAULT_PORT}\n"
        "\n"
        "[tools]\n"
        "# Directories searched for netlab, ansible-playbook and containerlab, before the service's own PATH.\n"
        f"path = [{shown}]\n"
        "# The netlab executable, if it is not on that path:\n"
        '# netlab = "~/venvs/netlab/bin/netlab"\n'
    )
