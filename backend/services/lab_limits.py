"""Time limits and quotas for shared lab servers — all opt-in.

* ``NETLAB_UI_LAB_HOURS`` — a lab deployed through the UI gets a lease of that
  many hours. When it runs out, :func:`reap_forever` shuts the lab down
  (``netlab down``) unless someone extended it first (:func:`extend`).
* ``NETLAB_UI_MAX_LABS_PER_USER`` — how many labs one login may have running
  at once; checked before ``netlab up``.
* ``NETLAB_UI_ADMINS`` — comma-separated logins exempt from the quota.

The lease rides on the owner registry (services/owners.py), which already
knows every lab the UI deployed; netlab itself knows nothing about it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from services import owners

logger = logging.getLogger(__name__)
REAP_INTERVAL_S = 60


def _float_env(name: str) -> float | None:
    try:
        value = float(os.environ.get(name, ""))
    except ValueError:
        return None
    return value if value > 0 else None


def lab_hours() -> float | None:
    return _float_env("NETLAB_UI_LAB_HOURS")


def max_labs_per_user() -> int | None:
    value = _float_env("NETLAB_UI_MAX_LABS_PER_USER")
    return int(value) if value else None


def admins() -> set[str]:
    return {name.strip() for name in os.environ.get("NETLAB_UI_ADMINS", "").split(",") if name.strip()}


def lease_expiry(now: datetime | None = None) -> str | None:
    hours = lab_hours()
    if not hours:
        return None
    return ((now or datetime.now(UTC)) + timedelta(hours=hours)).isoformat(timespec="seconds")


class QuotaExceeded(Exception):
    pass


def check_quota(user: str | None, status: dict[str, Any], lab_dir: str | Path) -> None:
    """Refuse another running lab for ``user`` beyond the per-user limit.
    Redeploying one of their own running labs doesn't count as another."""
    limit = max_labs_per_user()
    if not limit or not user or user in admins():
        return
    target = str(Path(lab_dir).resolve())
    mine = [
        lab
        for lab in owners.annotate(status).values()
        if isinstance(lab, dict) and lab.get("owner") == user and str(Path(str(lab.get("dir", ""))).resolve()) != target
    ]
    if len(mine) >= limit:
        names = ", ".join(str(lab.get("name") or lab.get("dir")) for lab in mine)
        raise QuotaExceeded(
            f"{user} already runs {len(mine)} lab(s) ({names}); the limit is {limit} per user. Shut one down first."
        )


def extend(lab_dir: str | Path) -> str | None:
    """Restart the lease of a running lab; returns the new expiry."""
    expiry = lease_expiry()
    if expiry:
        owners.update(lab_dir, expiresAt=expiry)
    return expiry


def expired(now: datetime | None = None) -> list[str]:
    moment = now or datetime.now(UTC)
    result = []
    for lab_dir, entry in owners.entries().items():
        stamp = entry.get("expiresAt") if isinstance(entry, dict) else None
        try:
            if stamp and datetime.fromisoformat(stamp) <= moment:
                result.append(lab_dir)
        except ValueError:
            continue
    return result


async def reap_once() -> list[str]:
    """``netlab down`` every lab whose lease ran out; returns their directories."""
    from services.netlab import runner

    reaped = []
    for lab_dir in expired():
        if not Path(lab_dir).is_dir():
            owners.forget(lab_dir)
            continue
        logger.warning("lab lease expired, shutting down %s", lab_dir)
        result = await runner.run_command(["down"], cwd=Path(lab_dir))
        if result.code == 0:
            owners.forget(lab_dir)
            runner._clear_status_cache()
            reaped.append(lab_dir)
        else:
            logger.warning("could not shut down expired lab %s: %s", lab_dir, result.stderr.strip()[-300:])
    return reaped


async def reap_forever() -> None:
    while True:
        await asyncio.sleep(REAP_INTERVAL_S)
        if lab_hours() is None:
            continue
        try:
            await reap_once()
        except Exception:  # the reaper must survive a bad lab
            logger.exception("lab lease reaper failed")
