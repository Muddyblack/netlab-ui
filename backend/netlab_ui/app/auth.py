"""Optional HTTP Basic auth for the whole app (UI, API, SSE and WebSockets).

The backend deploys labs and opens root shells on lab nodes, so anyone who can
reach it effectively owns the lab host. Loopback-only is the safe default; set
``NETLAB_UI_AUTH=user:password`` (several users: ``alice:pw1,bob:pw2``, or one
``user:password`` per line in the file named by ``NETLAB_UI_AUTH_FILE``) before
exposing it on a network. Browsers prompt once and then send the credentials
with every request of the origin — fetches, EventSource streams and WebSocket
upgrades alike — so the frontend needs no changes.

The authenticated user name is stored in the ASGI scope (``request.state.user``,
see :func:`request_user`) and recorded as the owner of labs it deploys.

API token (``NETLAB_UI_TOKEN``, ``NETLAB_UI_TOKEN_FILE`` or ``~/.config/netlab-ui/token``): remote clients (Electron,
the VS Code extension) send ``Authorization: Bearer <token>``, or ``?token=`` on EventSource and WebSocket URLs.
The token acts as a user named ``token``.

Exempt: ``/api/health`` (container health probes) and ``/mcp`` (the assistant's
MCP endpoint, which has its own bearer token and is called by agent CLIs, not
browsers).
"""

from __future__ import annotations

import base64
import binascii
import hmac
import os
from collections.abc import Awaitable, Callable, MutableMapping
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

ENV_VAR = "NETLAB_UI_AUTH"
FILE_ENV_VAR = "NETLAB_UI_AUTH_FILE"
TOKEN_ENV_VAR = "NETLAB_UI_TOKEN"
TOKEN_FILE_ENV_VAR = "NETLAB_UI_TOKEN_FILE"
TOKEN_USER = "token"
_EXEMPT_PREFIXES = ("/api/health", "/mcp")
_TOKEN_REQUIRED = (
    b"This netlab-ui requires its API token.\n"
    b"On the server, run `netlab-ui token` and open the link it prints (it signs this browser in).\n"
)


def _parse_entry(entry: str) -> tuple[str, str]:
    user, sep, password = entry.strip().partition(":")
    if not sep or not user or not password:
        raise RuntimeError(f"{ENV_VAR}/{FILE_ENV_VAR} entries must be 'user:password'")
    return user, password


def local_process_allowed(client_host: str | None) -> bool:
    """May this client start a program on the machine the backend runs on (an agent, a terminal)?

    That program runs as the user, with their files and logins. Without a login in front of
    netlab-ui, only the same machine may ask: anyone else who can reach the port would get it."""
    if auth_enabled():
        return True
    return client_host in {"127.0.0.1", "::1", "localhost"}


def configured_users() -> dict[str, str]:
    """``{user: password}`` from NETLAB_UI_AUTH and NETLAB_UI_AUTH_FILE."""
    users: dict[str, str] = {}
    raw = os.environ.get(ENV_VAR, "").strip()
    if raw:
        # A single entry may contain commas in its password; several entries
        # are separated by commas only when every part is a user:password.
        parts = raw.split(",")
        entries = parts if all(":" in part for part in parts) and len(parts) > 1 else [raw]
        users.update(_parse_entry(entry) for entry in entries)
    file_name = os.environ.get(FILE_ENV_VAR, "").strip()
    if file_name:
        for line in Path(file_name).expanduser().read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                users.update([_parse_entry(line)])
    return users


def default_token_file() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "netlab-ui" / "token"


def configured_token() -> str | None:
    """The API token for remote clients (Electron, the VS Code extension): NETLAB_UI_TOKEN, else the first
    line of NETLAB_UI_TOKEN_FILE, else of ``~/.config/netlab-ui/token`` (created by ``netlab-ui token``)."""
    raw = os.environ.get(TOKEN_ENV_VAR, "").strip()
    if raw:
        return raw
    file_name = os.environ.get(TOKEN_FILE_ENV_VAR, "").strip()
    path = Path(file_name).expanduser() if file_name else default_token_file()
    try:
        return path.read_text().strip().splitlines()[0].strip() or None
    except (OSError, IndexError):
        if file_name:
            raise
        return None


def auth_enabled() -> bool:
    return bool(configured_users() or configured_token())


def configured_credentials() -> tuple[str, str] | None:
    """The first configured user (kept for callers that need just one)."""
    users = configured_users()
    return next(iter(users.items()), None)


def _authenticated_user(header: bytes | None, users: dict[str, str]) -> str | None:
    if not header or header[:6].lower() != b"basic ":
        return None
    try:
        decoded = base64.b64decode(header[6:].strip(), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None
    got_user, _, got_password = decoded.partition(":")
    expected = users.get(got_user)
    # Compare against a dummy for unknown users so timing does not reveal them.
    ok = hmac.compare_digest(got_password.encode(), (expected or "\0invalid").encode())
    return got_user if ok and expected is not None else None


def request_user(request: Any) -> str | None:
    """The authenticated user of a request/WebSocket, or None without auth."""
    state = getattr(request, "state", None)
    return getattr(state, "user", None) if state is not None else None


def _token_matches(scope: Scope, token: str) -> bool:
    """Does the request carry the API token, as ``Authorization: Bearer`` or a ``?token=`` query parameter?

    The query form exists for EventSource and WebSocket, which cannot set headers from a browser or webview."""
    header = dict(scope.get("headers") or []).get(b"authorization") or b""
    candidates: list[str] = []
    if header[:7].lower() == b"bearer ":
        candidates.append(header[7:].strip().decode("utf-8", "replace"))
    candidates += parse_qs(scope.get("query_string", b"").decode("latin-1")).get("token", [])
    # Compare every candidate so timing does not reveal which one was right.
    return any(tuple(hmac.compare_digest(c.encode(), token.encode()) for c in candidates))


class BasicAuthMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so WebSocket upgrades are covered too.

    Accepts HTTP Basic credentials (``users``) and/or the API ``token``."""

    def __init__(
        self,
        app: ASGIApp,
        users: dict[str, str] | None = None,
        token: str | None = None,
        public: Callable[[str], bool] | None = None,
    ) -> None:
        self.app = app
        self.users = users or {}
        self.token = token
        # Paths served without credentials in token-only mode: the UI's own files. A browser loads its scripts
        # and styles with plain <script>/<link> tags, which carry neither the bearer header nor ?token=.
        self.public = public

    def _is_public(self, scope: Scope) -> bool:
        if self.users or self.public is None or scope["type"] != "http":
            return False
        return scope.get("method") in {"GET", "HEAD"} and self.public(scope.get("path", ""))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        exempt = scope.get("path", "").startswith(_EXEMPT_PREFIXES)
        # CORS preflights never carry credentials; CORSMiddleware answers them.
        preflight = scope["type"] == "http" and scope.get("method") == "OPTIONS"
        if scope["type"] not in {"http", "websocket"} or exempt or preflight or self._is_public(scope):
            await self.app(scope, receive, send)
            return
        header = dict(scope.get("headers") or []).get(b"authorization")
        user = _authenticated_user(header, self.users)
        if user is None and self.token and _token_matches(scope, self.token):
            user = TOKEN_USER
        if user is not None:
            scope.setdefault("state", {})["user"] = user
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            # Close before accepting: the browser reports a failed handshake.
            await send({"type": "websocket.close", "code": 1008})
            return
        # Only challenge for Basic when it can succeed: a browser prompt is pointless in token-only mode.
        challenge = [(b"www-authenticate", b'Basic realm="netlab-ui", charset="UTF-8"')] if self.users else []
        body = b"Authentication required" if self.users else _TOKEN_REQUIRED
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [*challenge, (b"content-type", b"text/plain; charset=utf-8")],
            }
        )
        await send({"type": "http.response.body", "body": body})
