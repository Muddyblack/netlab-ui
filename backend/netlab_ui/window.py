"""``netlab-ui --app``: run the server and show the UI in its own window instead of a browser tab.

In order of preference: a pywebview window (the ``window`` extra), a Chromium-family browser in app mode
(no tabs, no address bar), then the default browser.
"""

from __future__ import annotations

import importlib
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

CHROMIUM_BROWSERS = (
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
)
PYWEBVIEW_SPEC = "pywebview[qt]>=5"
TITLE = "netlab-ui"
STARTUP_TIMEOUT = 30.0


def run(config: uvicorn.Config, url: str) -> int:
    """Serve ``config`` in the background and block on a window showing ``url`` until it is closed."""
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not server.started:
        print("the server did not start; not opening a window", file=sys.stderr)
        server.should_exit = True
        thread.join(timeout=5)
        return 1
    try:
        _show(url)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
        thread.join(timeout=5)
    return 0


def _show(url: str) -> None:
    if _pywebview(url) or _chromium_app(url):
        return
    print(
        "no app window available: pywebview is not installed and no Chromium-based browser was found.\n"
        "  run it again in a terminal to install pywebview, or: sudo apt install chromium\n"
        f"opened {url} in your default browser instead",
        file=sys.stderr,
    )
    webbrowser.open(url)
    # The server lives in a daemon thread, so keep the process up until Ctrl-C.
    threading.Event().wait()


def _install_pywebview() -> bool:
    """Offer to pip install pywebview into this environment (where it was missing). False when declined or failed."""
    if "/nix/store/" in sys.prefix or not sys.stdin.isatty():
        return False  # nix owns this environment, or nobody is there to answer
    answer = input("pywebview (a native window, ~200 MB with Qt) is not installed. Install it now? [Y/n] ")
    if answer.strip().lower() not in {"", "y", "yes"}:
        return False
    result = subprocess.run([sys.executable, "-m", "pip", "install", PYWEBVIEW_SPEC], check=False)
    importlib.invalidate_caches()
    return result.returncode == 0


def _pywebview(url: str) -> bool:
    try:
        import webview
    except ImportError:
        if not _install_pywebview():
            return False
        try:
            import webview
        except ImportError:
            return False
    try:
        webview.create_window(TITLE, url, width=1440, height=900)
        webview.start()
    except Exception as exc:  # noqa: BLE001 - any failure (no GTK/Qt backend, no display) means fall back
        print(f"pywebview could not open a window ({exc}); trying a browser", file=sys.stderr)
        return False
    return True


def _chromium_app(url: str) -> bool:
    for name in CHROMIUM_BROWSERS:
        binary = shutil.which(name)
        if binary:
            # Chromium returns immediately when another instance of the profile is already running, so give the
            # app window its own profile directory: then this process lives exactly as long as the window.
            profile = _profile_dir()
            subprocess.run([binary, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run"], check=False)
            return True
    return False


def _profile_dir() -> str:
    path = Path.home() / ".cache" / "netlab-ui" / "app-profile"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)
