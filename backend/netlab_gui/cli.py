"""``netlab-gui`` command: run the backend, or install it as a systemd service."""

from __future__ import annotations

import argparse
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

UNIT_NAME = "netlab-gui.service"

UNIT_TEMPLATE = """\
[Unit]
Description=netlab GUI (web UI for netlab)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=on-failure
RestartSec=3
{service_extra}
[Install]
WantedBy={wanted_by}
"""


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    host = args.host or os.environ.get("UVICORN_HOST", "127.0.0.1")
    port = args.port or int(os.environ.get("UVICORN_PORT", "8000"))
    uvicorn.run("netlab_gui.app.main:app", host=host, port=port, timeout_graceful_shutdown=2)
    return 0


def _exec_start() -> str:
    """The command a unit should run: this entry point if it is on PATH, else this interpreter."""
    exe = shutil.which("netlab-gui")
    argv = [exe, "serve"] if exe else [sys.executable, "-m", "netlab_gui.cli", "serve"]
    return " ".join(shlex.quote(part) for part in argv)


def render_unit(system: bool, user: str | None = None) -> str:
    extra = f"User={user}\n" if system and user else ""
    return UNIT_TEMPLATE.format(
        exec_start=_exec_start(),
        service_extra=extra,
        wanted_by="multi-user.target" if system else "default.target",
    )


def _systemctl(system: bool, *argv: str) -> None:
    cmd = ["systemctl", *([] if system else ["--user"]), *argv]
    subprocess.run(cmd, check=True)


def _install_service(args: argparse.Namespace) -> int:
    system = args.system
    unit_dir = Path("/etc/systemd/system") if system else Path.home() / ".config" / "systemd" / "user"
    unit_path = unit_dir / UNIT_NAME
    if args.uninstall:
        _systemctl(system, "disable", "--now", UNIT_NAME)
        unit_path.unlink(missing_ok=True)
        _systemctl(system, "daemon-reload")
        print(f"removed {unit_path}")
        return 0
    # A system unit runs as the invoking (non-root) user: the lab tooling belongs to that user, not root.
    user = os.environ.get("SUDO_USER") or os.environ.get("USER")
    unit_dir.mkdir(parents=True, exist_ok=True)
    unit_path.write_text(render_unit(system, user))
    _systemctl(system, "daemon-reload")
    _systemctl(system, "enable", "--now", UNIT_NAME)
    if not system:
        # Keep the user service running after logout and start it at boot.
        subprocess.run(["loginctl", "enable-linger"], check=False)
    print(f"installed {unit_path}; open http://127.0.0.1:{os.environ.get('UVICORN_PORT', '8000')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="netlab-gui", description=__doc__)
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="run the web UI and API (default)")
    serve.add_argument("--host", help="bind address (default 127.0.0.1, or $UVICORN_HOST)")
    serve.add_argument("--port", type=int, help="port (default 8000, or $UVICORN_PORT)")
    serve.set_defaults(func=_serve)

    service = sub.add_parser("install-service", help="install and start a systemd service")
    service.add_argument("--system", action="store_true", help="system-wide unit (needs root) instead of a user unit")
    service.add_argument("--uninstall", action="store_true", help="stop and remove the service")
    service.set_defaults(func=_install_service)

    argv = sys.argv[1:] if argv is None else argv
    # `netlab-gui` and `netlab-gui --port 9000` both mean `serve`.
    if not argv or (argv[0].startswith("-") and argv[0] not in ("-h", "--help")):
        argv = ["serve", *argv]
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
