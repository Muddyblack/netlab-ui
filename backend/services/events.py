"""In-process pub/sub for push-based UI updates.

One :class:`Hub` fans events out to every connected SSE client, and a
``watchfiles``-based workspace watcher publishes ``{"type": "files"}`` whenever
anything inside a configured workspace changes on disk. This replaces frontend
interval polling: external edits (netlab runs, editors, git) surface in the UI
as they happen, and an idle backend does no periodic workspace scanning at all.

``watchfiles`` is optional — when it isn't installed the watcher simply never
starts and the frontend falls back to its (slower) polling interval.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path
from typing import Any

from services import workspaces as ws_store

logger = logging.getLogger(__name__)


class Hub:
    """Fan-out of JSON-able events to any number of async subscribers."""

    def __init__(self, max_queue: int = 64) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._max_queue = max_queue

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            # A stalled consumer must not block everyone else; it will
            # resync from its next successfully delivered event.
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(event)


hub = Hub()

# Set by workspace add/remove endpoints so the watcher re-reads its root list.
_watch_restart: asyncio.Event | None = None


def poke_watcher() -> None:
    """Ask the running watcher to restart with a fresh workspace list."""
    if _watch_restart is not None:
        _watch_restart.set()


async def watch_workspaces() -> None:
    """Long-running task: watch all workspace roots and publish ``files`` events.

    Restarts itself when :func:`poke_watcher` fires (workspace list changed)
    and when new roots appear on disk. Exits silently if watchfiles is missing.
    """
    global _watch_restart
    try:
        from watchfiles import awatch
    except ImportError:
        logger.info("watchfiles not installed - file change push disabled, frontend falls back to polling")
        return

    while True:
        roots = [p for p in ws_store.load() if Path(p).is_dir()]
        _watch_restart = asyncio.Event()
        if not roots:
            # Nothing to watch yet — wait for a workspace to be added.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(_watch_restart.wait(), timeout=30)
            continue
        try:
            # DefaultFilter already skips .git, __pycache__, node_modules etc.
            async for _changes in awatch(*roots, stop_event=_watch_restart, step=400):
                hub.publish({"type": "files"})
        except Exception:
            logger.exception("workspace watcher crashed; retrying in 10s")
            await asyncio.sleep(10)
