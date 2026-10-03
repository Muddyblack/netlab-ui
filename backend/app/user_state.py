"""Per-user UI state (pinned/recent labs, exercise progress).

* ``GET /api/user-state`` — everything stored for the current login
* ``PUT /api/user-state/{key}`` — replace one key's value

See :mod:`services.user_state` for what is kept here and why.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth import request_user
from services import user_state

router = APIRouter(prefix="/api/user-state", tags=["user-state"])


class UserStateValue(BaseModel):
    value: Any


@router.get("")
async def get_user_state(request: Request) -> dict[str, Any]:
    return user_state.get_all(request_user(request))


@router.put("/{key}")
async def put_user_state(key: str, body: UserStateValue, request: Request) -> dict[str, Any]:
    try:
        return {"value": user_state.put(request_user(request), key, body.value)}
    except KeyError as exc:
        raise HTTPException(404, f"unknown key {key!r}") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
