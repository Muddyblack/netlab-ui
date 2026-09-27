"""Optional HTTP Basic auth for the whole app (UI, API, SSE and WebSockets).

The backend deploys labs and opens root shells on lab nodes, so anyone who can
reach it effectively owns the lab host. Loopback-only is the safe default; set
``NETLAB_UI_AUTH=user:password`` before exposing it on a network. Browsers
prompt once and then send the credentials with every request of the origin —
fetches, EventSource streams and WebSocket upgrades alike — so the frontend
needs no changes.

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
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

ENV_VAR = "NETLAB_UI_AUTH"
_EXEMPT_PREFIXES = ("/api/health", "/mcp")


def configured_credentials() -> tuple[str, str] | None:
    raw = os.environ.get(ENV_VAR, "")
    if not raw.strip():
        return None
    user, sep, password = raw.partition(":")
    if not sep or not user or not password:
        raise RuntimeError(f"{ENV_VAR} must be 'user:password'")
    return user, password


def _authorized(header: bytes | None, user: str, password: str) -> bool:
    if not header or header[:6].lower() != b"basic ":
        return False
    try:
        decoded = base64.b64decode(header[6:].strip(), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return False
    got_user, _, got_password = decoded.partition(":")
    # Compare both halves regardless, so timing does not reveal which failed.
    user_ok = hmac.compare_digest(got_user.encode(), user.encode())
    password_ok = hmac.compare_digest(got_password.encode(), password.encode())
    return user_ok and password_ok


class BasicAuthMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so WebSocket upgrades are covered too."""

    def __init__(self, app: ASGIApp, user: str, password: str) -> None:
        self.app = app
        self.user = user
        self.password = password

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        exempt = scope.get("path", "").startswith(_EXEMPT_PREFIXES)
        # CORS preflights never carry credentials; CORSMiddleware answers them.
        preflight = scope["type"] == "http" and scope.get("method") == "OPTIONS"
        if scope["type"] not in {"http", "websocket"} or exempt or preflight:
            await self.app(scope, receive, send)
            return
        header = dict(scope.get("headers") or []).get(b"authorization")
        if _authorized(header, self.user, self.password):
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
