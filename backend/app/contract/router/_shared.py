"""Shared router instance + session-resolution helper for the contract API.

Domain submodules (sessions, model, templates, groups, multiserver,
custom_nodes) all register their routes on this one ``router`` so the whole
package still mounts as a single ``/api/topology`` prefix.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.sessions.store import store

router = APIRouter(prefix="/api/topology", tags=["topology"])
logger = logging.getLogger(__name__)


def session_or_404(session_id: str):
    """Resolve a session id to its live session, or raise the contract's 404."""
    try:
        return store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc
