"""``netlab-ui`` command: run the backend, or install it as a systemd service."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import secrets
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from netlab_ui import config, service
from netlab_ui.app import auth


def _load_settings() -> config.Settings | None:
    try:
        return config.load()
    except config.ConfigError as exc:
        print(f"config problem: {exc}", file=sys.stderr)
        return None


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    settings = _load_settings()
    if settings is None:
        return 2
    config.apply_tools(settings)
    # Flag, then environment variable, then the config file, then the default.
    host = args.host or os.environ.get("UVICORN_HOST") or settings.host
    raw_port = os.environ.get("UVICORN_PORT", "").strip()
    if args.port:
        port = args.port
    elif raw_port:
        if not raw_port.isdigit() or not 0 < int(raw_port) < 65536:
            print(f"UVICORN_PORT must be a port number (1-65535), not {raw_port!r}", file=sys.stderr)
            return 2
        port = int(raw_port)
    else:
        port = settings.port
    if not _is_loopback(host) and not auth.auth_enabled():
        print(
            f"warning: listening on {host} without a login: anyone who can reach port {port} can deploy labs\n"
            "and read and change your lab files. Create a token with `netlab-ui token`,\n"
            "or set NETLAB_UI_AUTH=user:password.",
            file=sys.stderr,
        )
    uvicorn.run("netlab_ui.app.main:app", host=host, port=port, timeout_graceful_shutdown=2)
    return 0


def _is_loopback(host: str) -> bool:
    return host in {"localhost", "::1"} or host.startswith("127.")


def _config(_args: argparse.Namespace) -> int:
    """Show where the config file is and what the server would use."""
    path = config.default_path()
    settings = _load_settings()
    if settings is None:
        return 2
    print(
        f"config file  {path}"
        + ("" if path.is_file() else "  (not created yet: `netlab-ui install-service` writes one)")
    )
    print(f"listen       {settings.host}:{settings.port}")
    print(f"tool path    {os.pathsep.join(settings.path) or '(none)'}")
    print(f"netlab       {settings.netlab or '(found on PATH)'}")
    search = os.pathsep.join([*settings.path, os.environ.get("PATH", "")])
    for tool in service.TOOLS:
        print(f"  {tool:<17}{shutil.which(tool, path=search) or 'not found'}")
    return 0


def _install_service(args: argparse.Namespace) -> int:
    return service.uninstall(args.system) if args.uninstall else service.install(args.system)


def _token(args: argparse.Namespace) -> int:
    """Print the API token remote clients use, creating one on first use (``--rotate`` replaces it)."""
    path = auth.default_token_file()
    current = auth.configured_token()
    if current and not args.rotate:
        print(current)
        _print_sign_in_link(current)
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create with 0600 from the start so the secret is never world-readable.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(secrets.token_urlsafe(32) + "\n")
    path.chmod(0o600)
    token = path.read_text().strip()
    print(token)
    print(f"saved to {path}", file=sys.stderr)
    if restart_user_service():
        print("restarted the netlab-ui service so it uses the new token", file=sys.stderr)
    else:
        print("restart netlab-ui to enforce it", file=sys.stderr)
    _print_sign_in_link(token)
    return 0


def _print_sign_in_link(token: str) -> None:
    """A browser opening this link stores the token and is signed in (see installApiAuth in the frontend)."""
    settings = _load_settings() or config.Settings()
    host = "<this-host>" if settings.host in {"", "0.0.0.0", "::"} else settings.host
    print(f"sign in a browser with: {service.base_url(host, settings.port)}/?token={token}", file=sys.stderr)


def restart_user_service() -> bool:
    """Restart the systemd user service if it is running. False when there is none (or no systemd)."""
    try:
        result = subprocess.run(
            ["systemctl", "--user", "try-restart", service.UNIT_NAME], capture_output=True, check=False
        )
    except OSError:
        return False
    if result.returncode != 0:
        return False
    try:
        active = subprocess.run(
            ["systemctl", "--user", "is-active", service.UNIT_NAME], capture_output=True, text=True, check=False
        )
    except OSError:
        return False
    return active.stdout.strip() == "active"


PACKAGE = "netlab-ui"


def installed_version() -> str:
    try:
        return importlib.metadata.version(PACKAGE)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def latest_version() -> str | None:
    """Newest release on PyPI, or None when it cannot be reached."""
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{PACKAGE}/json", timeout=10) as res:
            return json.load(res)["info"]["version"]
    except (OSError, ValueError, KeyError):
        return None


def upgrade_command(prefix: str = sys.prefix) -> list[str] | None:
    """The command that upgrades this install, or None when the package manager owns it (nix, a checkout)."""
    if "/nix/store/" in prefix:
        return None
    if "/pipx/venvs/" in prefix or "/.local/share/pipx" in prefix:
        return ["pipx", "upgrade", PACKAGE]
    if Path(__file__).resolve().parents[2].joinpath(".git").exists():
        return None
    return [sys.executable, "-m", "pip", "install", "--upgrade", PACKAGE]


def _upgrade(args: argparse.Namespace) -> int:
    current, latest = installed_version(), latest_version()
    if latest is None:
        print("could not reach PyPI to look for a newer version", file=sys.stderr)
    elif latest == current:
        print(f"netlab-ui {current} is the latest version")
        return 0
    else:
        print(f"netlab-ui {current} -> {latest}")
    if args.check:
        return 0 if latest is None or latest == current else 10
    command = upgrade_command()
    if command is None:
        print("this install is managed elsewhere (nix or a source checkout): update it there", file=sys.stderr)
        return 1
    subprocess.run(command, check=True)
    # Pick up the new code if the service is running as a user unit (a system unit needs root: say so).
    restarted = restart_user_service()
    if not restarted and Path("/etc/systemd/system", service.UNIT_NAME).exists():
        print(f"restart the system service to finish: sudo systemctl restart {service.UNIT_NAME}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="netlab-ui", description=__doc__)
    parser.add_argument("--version", action="version", version=f"netlab-ui {installed_version()}")
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="run the web UI and API (default)")
    serve.add_argument("--host", help="bind address (default 127.0.0.1, or $UVICORN_HOST)")
    serve.add_argument("--port", type=int, help="port (default 8000, or $UVICORN_PORT)")
    serve.set_defaults(func=_serve)

    cfg = sub.add_parser("config", help="show the config file location and the settings the server will use")
    cfg.set_defaults(func=_config)

    svc = sub.add_parser("install-service", help="install and start a systemd service")
    svc.add_argument("--system", action="store_true", help="system-wide unit (needs root) instead of a user unit")
    svc.add_argument("--uninstall", action="store_true", help="stop and remove the service")
    svc.set_defaults(func=_install_service)

    upgrade = sub.add_parser("upgrade", help="upgrade netlab-ui to the latest release and restart the service")
    upgrade.add_argument(
        "--check", action="store_true", help="only report whether a newer version exists (exit 10 if so)"
    )
    upgrade.set_defaults(func=_upgrade)

    token = sub.add_parser("token", help="print the API token for remote clients, creating it if needed")
    token.add_argument("--rotate", action="store_true", help="replace the stored token with a new one")
    token.set_defaults(func=_token)

    argv = sys.argv[1:] if argv is None else argv
    # `netlab-ui` and `netlab-ui --port 9000` both mean `serve`.
    if not argv or (argv[0].startswith("-") and argv[0] not in ("-h", "--help", "--version")):
        argv = ["serve", *argv]
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
