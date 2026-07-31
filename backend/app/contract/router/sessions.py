"""The four endpoints of clab-ui's ``ClabUiHost`` API contract:
create/delete session, snapshot, command."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel
from ruamel.yaml import YAMLError

from app.contract import commands, snapshot
from app.contract.responses import CommandAck, CreateSessionResult, OkResult, SnapshotResponse
from app.contract.router._shared import logger, router, session_or_404
from app.lab import common
from app.sessions.store import store
from services.netlab import runner


class CreateSession(BaseModel):
    topologyPath: str
    mode: str = "edit"


class SnapshotRequest(BaseModel):
    sessionId: str
    scope: dict | None = None


class CommandRequest(BaseModel):
    sessionId: str
    command: dict


@router.post("/sessions", response_model=CreateSessionResult)
def create_session(body: CreateSession):
    # The single chokepoint where a client-supplied topology path enters the
    # backend: everything downstream (the model store, annotation sidecars, the
    # unit library) derives its paths from `session.topology_path`. Pin it to a
    # configured workspace here so no later writer has to re-validate.
    session = store.create(str(common.resolve_workspace_path(body.topologyPath)), body.mode)
    return {"sessionId": session.id, "topologyRef": session.topology_path, "mode": session.mode}


@router.delete("/sessions/{session_id}", response_model=OkResult)
def delete_session(session_id: str):
    store.delete(session_id)
    return {"ok": True}


async def build_snapshot(session, scope: dict | None = None) -> dict:
    """Assemble the clab-ui ``TopologySnapshot`` for a session, threading the
    host's real undo/redo availability through so the Navbar buttons reflect it."""
    # Spike fallback: no netlab AND no topology file yet -> serve the fixture so
    # the clab-ui integration can be exercised with zero setup.
    if not runner.is_installed() and not Path(session.topology_path).exists():
        return snapshot.STATIC_FIXTURE

    try:
        topo = commands.load_topology(session.topology_path)
    except YAMLError as exc:
        # Surface a structured parse error (with the offending line, when ruamel
        # marks it) instead of a 500 + stack trace, so the UI can point the user
        # straight at the broken line.
        mark = getattr(exc, "problem_mark", None)
        raise HTTPException(
            422,
            {
                "error": "YAML syntax error",
                "detail": str(exc),
                "line": mark.line if mark is not None else None,
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(422, f"Invalid topology YAML: {exc}") from exc

    host = session.host
    return await snapshot.build(
        session.topology_path,
        topo,
        session.revision,
        scope,
        session.mode,
        can_undo=host.can_undo if host else False,
        can_redo=host.can_redo if host else False,
    )


@router.post("/snapshot", response_model=SnapshotResponse)
async def get_snapshot(body: SnapshotRequest):
    session = session_or_404(body.sessionId)
    return {"snapshot": await build_snapshot(session, body.scope)}


@router.post("/command", response_model=CommandAck)
async def apply_command(body: CommandRequest):
    session = session_or_404(body.sessionId)

    # Route through the per-session host: it owns undo/redo history + revision,
    # rolls back the YAML/annotations files on failure, and (via the inline
    # snapshot below) lets clab-ui apply the result without a second round-trip.
    result = session.host.apply_command(body.command)
    if not result.ok:
        logger.error("command failed: %s\ncommand: %s", result.error, json.dumps(body.command, indent=2))
        return {
            "type": "topology-host:error",
            "protocolVersion": 1,
            "requestId": "",
            "error": result.error or "command failed",
        }

    snap = await build_snapshot(session, body.command.get("scope"))
    return {
        "type": "topology-host:ack",
        "protocolVersion": 1,
        "requestId": "",
        "revision": result.revision,
        "snapshot": snap,
    }
