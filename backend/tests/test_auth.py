import base64

from fastapi import FastAPI, Request, WebSocket
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

    @app.get("/api/whoami")
    def whoami(request: Request):
        return {"user": auth.request_user(request)}

    @app.websocket("/api/node/r1/shell")
    async def shell(ws: WebSocket):
        await ws.accept()
        await ws.send_text("hi")
        await ws.close()

    app.add_middleware(auth.BasicAuthMiddleware, users={"admin": "s3cret", "bob": "pw2"})
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


def test_request_carries_the_authenticated_user():
    client = _client()
    assert client.get("/api/whoami", headers=_basic("bob", "pw2")).json() == {"user": "bob"}
    assert client.get("/api/whoami", headers=_basic("bob", "s3cret")).status_code == 401


def test_credentials_parsing(monkeypatch, tmp_path):
    monkeypatch.delenv(auth.ENV_VAR, raising=False)
    monkeypatch.delenv(auth.FILE_ENV_VAR, raising=False)
    assert auth.configured_users() == {}
    monkeypatch.setenv(auth.ENV_VAR, "me:pa:ss")
    assert auth.configured_users() == {"me": "pa:ss"}
    monkeypatch.setenv(auth.ENV_VAR, "alice:one,bob:two")
    assert auth.configured_users() == {"alice": "one", "bob": "two"}
    monkeypatch.setenv(auth.ENV_VAR, "me:a,b")  # a comma inside a single password
    assert auth.configured_users() == {"me": "a,b"}
    users_file = tmp_path / "users"
    users_file.write_text("# team\ncarol:three\n")
    monkeypatch.delenv(auth.ENV_VAR)
    monkeypatch.setenv(auth.FILE_ENV_VAR, str(users_file))
    assert auth.configured_users() == {"carol": "three"}
    monkeypatch.setenv(auth.FILE_ENV_VAR, "")
    monkeypatch.setenv(auth.ENV_VAR, "nopassword")
    try:
        auth.configured_users()
        raise AssertionError("expected a configuration error")
    except RuntimeError:
        pass
