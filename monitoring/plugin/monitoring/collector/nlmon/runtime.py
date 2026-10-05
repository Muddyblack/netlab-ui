"""Find the host PID of container nodes through the Docker (or Podman) API socket."""

from __future__ import annotations

import http.client
import json
import os
import socket
import threading
import time
import urllib.parse


class _UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float = 5.0) -> None:
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._path)
        self.sock = sock


class ContainerRuntime:
    """Container name -> (pid, id) with a short-lived cache.

    A cached PID is trusted as long as /proc/<pid> still exists and the entry is
    younger than ``ttl`` seconds, so a steady-state cycle makes no API calls at all.
    """

    def __init__(self, socket_path: str, proc: str = "/proc", ttl: float = 60.0) -> None:
        self.socket_path = socket_path
        self.proc = proc
        self.ttl = ttl
        self._cache: dict[str, tuple[int, str, float]] = {}
        self._lock = threading.Lock()

    def _get(self, path: str) -> dict | None:
        conn = _UnixHTTPConnection(self.socket_path)
        try:
            conn.request("GET", path)
            resp = conn.getresponse()
            body = resp.read()
            if resp.status != 200:
                return None
            return json.loads(body)
        except (OSError, ValueError, http.client.HTTPException):
            return None
        finally:
            conn.close()

    def lookup(self, name: str) -> tuple[int, str] | None:
        """(pid, container id) of a running container, or None."""
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(name)
        if cached and now - cached[2] < self.ttl and os.path.exists(f"{self.proc}/{cached[0]}"):
            return cached[0], cached[1]
        data = self._get(f"/containers/{urllib.parse.quote(name)}/json")
        state = (data or {}).get("State") or {}
        pid = int(state.get("Pid") or 0)
        if not data or not state.get("Running") or pid <= 0:
            with self._lock:
                self._cache.pop(name, None)
            return None
        with self._lock:
            self._cache[name] = (pid, str(data.get("Id") or ""), now)
        return pid, str(data.get("Id") or "")
