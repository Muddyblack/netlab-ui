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

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

ENV_VAR = "NETLAB_UI_AUTH"
FILE_ENV_VAR = "NETLAB_UI_AUTH_FILE"
_EXEMPT_PREFIXES = ("/api/health", "/mcp")


def _parse_entry(entry: str) -> tuple[str, str]:
    user, sep, password = entry.strip().partition(":")
    if not sep or not user or not password:
        raise RuntimeError(f"{ENV_VAR}/{FILE_ENV_VAR} entries must be 'user:password'")
    return user, password


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


class BasicAuthMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so WebSocket upgrades are covered too."""

    def __init__(self, app: ASGIApp, users: dict[str, str]) -> None:
        self.app = app
        self.users = users

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        exempt = scope.get("path", "").startswith(_EXEMPT_PREFIXES)
        # CORS preflights never carry credentials; CORSMiddleware answers them.
        preflight = scope["type"] == "http" and scope.get("method") == "OPTIONS"
        if scope["type"] not in {"http", "websocket"} or exempt or preflight:
            await self.app(scope, receive, send)
            return
        header = dict(scope.get("headers") or []).get(b"authorization")
        user = _authenticated_user(header, self.users)
        if user is not None:
            scope.setdefault("state", {})["user"] = user
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            # Close before accepting: the browser reports a failed handshake.
            await send({"type": "websocket.close", "code": 1008})
            return
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"www-authenticate", b'Basic realm="netlab-ui", charset="UTF-8"'),
                    (b"content-type", b"text/plain; charset=utf-8"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": b"Authentication required"})
