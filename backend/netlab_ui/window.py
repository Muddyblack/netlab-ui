"""``netlab-ui --app``: run the server and show the UI in its own window instead of a browser tab.

In order of preference: a pywebview window (the ``window`` extra), a Chromium-family browser in app mode
(no tabs, no address bar), then the default browser.
"""

from __future__ import annotations

import importlib
import importlib.util
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

from netlab_ui import config

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


MODES = ("webview", "chromium", "browser")


def run(server_config: uvicorn.Config, url: str, mode: str = "auto") -> int:
    """Serve ``server_config`` in the background and block on a window showing ``url`` until it is closed.

    ``mode`` is one of MODES, ``ask`` (show the menu again) or ``auto`` (the saved choice, else ask on a terminal,
    else the first window that works).
    """
    chosen = choose_mode(mode)
    server = uvicorn.Server(server_config)
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
        _show(url, chosen)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
        thread.join(timeout=5)
    return 0


def _choice_file() -> Path:
    return config.default_path().parent / "app-window"


def choose_mode(mode: str) -> str | None:
    """Which window to use: an explicit mode, the saved choice, or what the user picks from the menu.

    None means "no preference": use the first one that works.
    """
    if mode in MODES:
        return mode
    if mode == "auto":
        try:
            saved = _choice_file().read_text().strip()
        except OSError:
            saved = ""
        if saved in MODES:
            return saved
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return None
    options = _options()
    picked = _menu(
        "How should netlab-ui open? (arrows + enter, remembered; `--app=ask` asks again)", [o[1] for o in options]
    )
    if picked is None:
        return None
    chosen = options[picked][0]
    try:
        _choice_file().parent.mkdir(parents=True, exist_ok=True)
        _choice_file().write_text(chosen + "\n")
    except OSError:
        pass  # the choice just is not remembered
    return chosen


def _options() -> list[tuple[str, str]]:
    have_webview = importlib.util.find_spec("webview") is not None
    options = [
        ("webview", "pywebview: native window" + ("" if have_webview else " (installs ~200 MB)")),
    ]
    browser = next((b for b in CHROMIUM_BROWSERS if shutil.which(b)), None)
    if browser:
        options.append(("chromium", f"{browser}: app window, no tabs"))
    options.append(("browser", "default browser tab"))
    return options


def _menu(title: str, labels: list[str]) -> int | None:
    """Pick one of ``labels`` with the arrow keys (or j/k) and enter. None when cancelled."""
    try:
        import termios
        import tty
    except ImportError:  # not a POSIX terminal
        print(title)
        for number, label in enumerate(labels, 1):
            print(f"  {number}) {label}")
        answer = input("number: ").strip()
        return int(answer) - 1 if answer.isdigit() and 0 < int(answer) <= len(labels) else None
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    index = 0

    def draw(first: bool) -> None:
        if not first:
            sys.stdout.write(f"\x1b[{len(labels)}F")
        for i, label in enumerate(labels):
            sys.stdout.write("\x1b[2K" + (f"\x1b[1m> {label}\x1b[0m" if i == index else f"  {label}") + "\n")
        sys.stdout.flush()

    print(title)
    try:
        tty.setcbreak(fd)
        draw(True)
        while True:
            key = sys.stdin.read(1)
            if key == "\x1b":
                key += sys.stdin.read(2)
            if key in {"\x1b[A", "k"}:
                index = (index - 1) % len(labels)
            elif key in {"\x1b[B", "j"}:
                index = (index + 1) % len(labels)
            elif key in {"\r", "\n"}:
                return index
            elif key in {"q", "\x03", "\x04"}:
                return None
            draw(False)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def _show(url: str, mode: str | None = None) -> None:
    if mode == "browser":
        webbrowser.open(url)
        threading.Event().wait()
        return
    if mode == "chromium" and _chromium_app(url):
        return
    if mode == "webview" and _pywebview(url):
        return
    if mode is None and (_pywebview(url) or _chromium_app(url)):
        return
    if mode in {"webview", "chromium"} and (_pywebview(url) or _chromium_app(url)):
        return  # the chosen one failed: try the others
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


def _patch_qt_permissions() -> None:
    """pywebview 6.2 passes a bare int to QWebEnginePage.setFeaturePermission, which PySide6 rejects with a
    TypeError inside a Qt callback, and Qt then aborts the process when the page asks for a permission
    (clipboard, notifications...). Convert the int to the enum the binding wants."""
    try:
        from qtpy.QtWebEngineCore import QWebEnginePage
    except ImportError:
        return
    original = QWebEnginePage.setFeaturePermission
    policy = QWebEnginePage.PermissionPolicy

    def set_feature_permission(self, origin, feature, value):
        if not isinstance(value, policy):
            value = policy(value)
        return original(self, origin, feature, value)

    QWebEnginePage.setFeaturePermission = set_feature_permission


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
        # Qt is what the window extra installs; naming it skips a noisy GTK attempt on machines without PyGObject.
        qt = importlib.util.find_spec("qtpy") is not None
        if qt:
            _patch_qt_permissions()
        webview.create_window(TITLE, url, width=1440, height=900)
        webview.start(gui="qt" if qt else None)
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
