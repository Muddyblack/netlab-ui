"""Install ``netlab-ui`` as a systemd service and report whether it really came up."""

from __future__ import annotations

import contextlib
import getpass
import os
import pwd
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from netlab_ui import config

UNIT_NAME = "netlab-ui.service"
# What the service has to find on its PATH to deploy labs.
TOOLS = ("netlab", "ansible-playbook", "containerlab")

UNIT_TEMPLATE = """\
[Unit]
Description=netlab-ui (web UI for netlab)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
{environment}Restart=on-failure
RestartSec=3
{service_extra}
[Install]
WantedBy={wanted_by}
"""


def _env_line(name: str, value: str) -> str:
    """An ``Environment=`` line; systemd expands ``%`` specifiers and interprets quotes and backslashes."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    return f'Environment="{name}={escaped}"\n'


def _exec_start() -> str:
    """The command a unit should run: this entry point if it is on PATH, else this interpreter."""
    exe = shutil.which("netlab-ui")
    argv = [exe, "serve"] if exe else [sys.executable, "-m", "netlab_ui.cli", "serve"]
    return " ".join(shlex.quote(part) for part in argv)


def find_tool_dirs(search_path: str | None = None) -> list[str]:
    """Directories (as a shell would find them) holding netlab, Ansible and containerlab, without duplicates."""
    dirs: list[str] = []
    for tool in TOOLS:
        found = shutil.which(tool, path=search_path)
        if found and (parent := str(Path(found).parent)) not in dirs:
            dirs.append(parent)
    return dirs


def service_path(tool_dirs: list[str], current: str | None = None) -> str:
    """PATH for the unit: the tool directories first, then the installing shell's PATH."""
    entries = [*tool_dirs, *(current if current is not None else os.environ.get("PATH", "")).split(os.pathsep)]
    seen: list[str] = []
    for entry in entries:
        if entry and entry not in seen:
            seen.append(entry)
    return os.pathsep.join(seen)


def render_unit(system: bool, user: str | None = None, path_env: str | None = None) -> str:
    return UNIT_TEMPLATE.format(
        exec_start=_exec_start(),
        environment=_env_line("PATH", path_env) if path_env else "",
        service_extra=f"User={user}\n" if system and user else "",
        wanted_by="multi-user.target" if system else "default.target",
    )


def _systemctl(system: bool, *argv: str) -> subprocess.CompletedProcess[str]:
    cmd = ["systemctl", *([] if system else ["--user"]), *argv]
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _linger_enabled() -> bool:
    try:
        out = subprocess.run(
            ["loginctl", "show-user", getpass.getuser(), "--property=Linger", "--value"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return False
    return out.stdout.strip() == "yes"


def ensure_linger() -> str | None:
    """Let the user service run at boot and after logout. Returns a warning if that did not work, else None."""
    user = getpass.getuser()
    if _linger_enabled():
        return None
    with contextlib.suppress(OSError):
        subprocess.run(["loginctl", "enable-linger"], capture_output=True, text=True, check=False)
    if _linger_enabled():
        return None
    return (
        "Could not enable lingering, so the service only runs while you are logged in "
        f"(it will not start at boot). To fix that run: sudo loginctl enable-linger {user}"
    )


def base_url(host: str, port: int) -> str:
    """``http://host:port``, with an IPv6 address in brackets."""
    return f"http://[{host}]:{port}" if ":" in host else f"http://{host}:{port}"


def _health_url(settings: config.Settings) -> str:
    host = "127.0.0.1" if settings.host in {"", "0.0.0.0"} else "::1" if settings.host == "::" else settings.host
    return base_url(host, settings.port)


def wait_until_running(system: bool, settings: config.Settings, timeout: float = 20.0) -> bool:
    """Is the unit active and answering on its port? Polls, since a start can take a few seconds."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = _systemctl(system, "is-active", UNIT_NAME).stdout.strip()
        if state == "failed":
            return False
        if state == "active":
            try:
                with urllib.request.urlopen(f"{_health_url(settings)}/api/health", timeout=2):
                    return True
            except (OSError, urllib.error.URLError):
                pass
        time.sleep(1)
    return False


def recent_log(system: bool, lines: int = 15) -> str:
    cmd = ["journalctl", *([] if system else ["--user"]), "-u", UNIT_NAME, "-n", str(lines), "--no-pager", "-o", "cat"]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout.strip()
    except OSError:
        return ""


def commands_hint(system: bool) -> str:
    scope = "" if system else " --user"
    return (
        f"  status   systemctl{scope} status netlab-ui\n"
        f"  logs     journalctl{scope} -u netlab-ui -f\n"
        f"  restart  systemctl{scope} restart netlab-ui"
    )


def _target_user(system: bool) -> tuple[str, Path]:
    """Whose files the service uses: the invoking user, even under sudo."""
    name = (os.environ.get("SUDO_USER") if system else None) or getpass.getuser()
    try:
        return name, Path(pwd.getpwnam(name).pw_dir)
    except KeyError:
        return name, Path.home()


def _write_config(path: Path, tool_dirs: list[str], owner: str) -> bool:
    """Create the starter config unless one exists. Returns True if it was written."""
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    shown = [d for d in tool_dirs if d not in config.SYSTEM_DIRS]
    path.write_text(config.template(shown))
    if os.geteuid() == 0 and owner != "root":
        try:
            info = pwd.getpwnam(owner)
        except KeyError:
            return True  # no such account to hand the file to; it stays root's
        os.chown(path, info.pw_uid, info.pw_gid)
        os.chown(path.parent, info.pw_uid, info.pw_gid)
    return True


def uninstall(system: bool) -> int:
    unit_dir = Path("/etc/systemd/system") if system else Path.home() / ".config" / "systemd" / "user"
    unit_path = unit_dir / UNIT_NAME
    _systemctl(system, "disable", "--now", UNIT_NAME)
    unit_path.unlink(missing_ok=True)
    _systemctl(system, "daemon-reload")
    print(f"removed {unit_path} (the config file and token are kept)")
    return 0


def install(system: bool) -> int:
    if not shutil.which("systemctl"):
        print("systemd was not found on this machine; start the server with `netlab-ui` instead.", file=sys.stderr)
        return 1
    if system and os.geteuid() != 0:
        print("a system-wide service needs root: run `sudo netlab-ui install-service --system`.", file=sys.stderr)
        return 1
    probe = _systemctl(system, "daemon-reload")
    if probe.returncode != 0:
        where = "" if system else " (try from a normal login session, or use --system)"
        print(f"could not reach systemd{where}: {probe.stderr.strip()}", file=sys.stderr)
        return 1

    user, home = _target_user(system)
    unit_dir = Path("/etc/systemd/system") if system else home / ".config" / "systemd" / "user"
    unit_path = unit_dir / UNIT_NAME

    tool_dirs = find_tool_dirs()
    missing = [tool for tool in TOOLS if not shutil.which(tool)]
    config_path = config.default_path(home)
    created = _write_config(config_path, tool_dirs, user)
    try:
        settings = config.load(config_path)
    except config.ConfigError as exc:
        print(f"config problem: {exc}", file=sys.stderr)
        return 1

    unit_dir.mkdir(parents=True, exist_ok=True)
    unit_path.write_text(render_unit(system, user, service_path(tool_dirs + settings.path)))
    enable = _systemctl(system, "enable", "--now", UNIT_NAME)
    if enable.returncode != 0:
        print(f"could not enable the service: {enable.stderr.strip()}", file=sys.stderr)
        return 1

    warnings = [ensure_linger()] if not system else []
    if missing:
        warnings.append(
            f"not found on PATH now: {', '.join(missing)}. The service cannot deploy labs until they are installed; "
            f"if they live somewhere unusual, list the directory under [tools] path in {config_path}."
        )

    print(f"installed {unit_path}" + (f"\nwrote {config_path}" if created else f"\nusing {config_path}"))
    ok = wait_until_running(system, settings)
    if ok:
        print(f"\nnetlab-ui is running: {_health_url(settings)}")
    else:
        print("\nnetlab-ui did not start. Last log lines:", file=sys.stderr)
        print(recent_log(system) or "  (no log output)", file=sys.stderr)
    print(commands_hint(system))
    print(f"  config   {config_path}")
    for warning in filter(None, warnings):
        print(f"\nwarning: {warning}", file=sys.stderr)
    return 0 if ok else 1
