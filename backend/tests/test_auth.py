import base64

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import auth


def _client() -> TestClient:
    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/lab/files")
    def files():
        return []

    @app.websocket("/api/node/r1/shell")
    async def shell(ws: WebSocket):
        await ws.accept()
        await ws.send_text("hi")
        await ws.close()

    app.add_middleware(auth.BasicAuthMiddleware, user="admin", password="s3cret")
    return TestClient(app)


def _basic(user: str, password: str) -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


def test_requests_without_credentials_are_challenged():
    res = _client().get("/api/lab/files")
    assert res.status_code == 401
    assert res.headers["www-authenticate"].startswith("Basic ")


def test_wrong_and_right_credentials():
    client = _client()
    assert client.get("/api/lab/files", headers=_basic("admin", "nope")).status_code == 401
    assert client.get("/api/lab/files", headers=_basic("admin", "s3cret")).status_code == 200


def test_health_and_preflight_are_exempt():
    client = _client()
    assert client.get("/api/health").status_code == 200
    assert client.options("/api/lab/files").status_code != 401


def test_websocket_requires_credentials():
    client = _client()
    try:
        with client.websocket_connect("/api/node/r1/shell"):
            raise AssertionError("unauthenticated websocket was accepted")
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
    with client.websocket_connect("/api/node/r1/shell", headers=_basic("admin", "s3cret")) as ws:
        assert ws.receive_text() == "hi"


def test_credentials_parsing(monkeypatch):
    monkeypatch.delenv(auth.ENV_VAR, raising=False)
    assert auth.configured_credentials() is None
    monkeypatch.setenv(auth.ENV_VAR, "me:pa:ss")
    assert auth.configured_credentials() == ("me", "pa:ss")
    monkeypatch.setenv(auth.ENV_VAR, "nopassword")
    try:
        auth.configured_credentials()
        raise AssertionError("expected a configuration error")
    except RuntimeError:
        pass
