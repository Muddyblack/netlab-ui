"""In-memory session registry.

A *session* binds a clab-ui editing session to a topology file on disk plus a
monotonic revision counter (bumped on every structural mutation, so clab-ui can
tell its cached snapshot is stale). This is intentionally tiny and process-local;
persistence/auth is out of scope for the MVP (and, per clab-ui's contract, the
host's responsibility — to be added later).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from services.topology_host import NetlabTopologyHost


@dataclass
class Session:
    id: str
    topology_path: str
    mode: str = "edit"
    host: NetlabTopologyHost | None = None

    @property
    def revision(self) -> int:
        # The host is the single source of truth for the revision counter.
        return self.host.revision if self.host is not None else 0


@dataclass
class SessionStore:
    _sessions: dict[str, Session] = field(default_factory=dict)

    def create(self, topology_path: str, mode: str = "edit") -> Session:
        sid = uuid.uuid4().hex
        session = Session(
            id=sid,
            topology_path=topology_path,
            mode=mode,
            host=NetlabTopologyHost(topology_path),
        )
        self._sessions[sid] = session
        return session

    def get(self, sid: str) -> Session | None:
        return self._sessions.get(sid)

    def require(self, sid: str) -> Session:
        session = self._sessions.get(sid)
        if session is None:
            raise KeyError(sid)
        return session

    def delete(self, sid: str) -> None:
        self._sessions.pop(sid, None)


# Process-wide singleton.
store = SessionStore()
