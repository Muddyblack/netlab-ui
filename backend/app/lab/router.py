"""Aggregator for the ``/api/lab`` surface.

The actual endpoints live in sibling modules, grouped by concern:

* :mod:`app.lab.capture` — Edgeshark install/uninstall + Wireshark VNC capture
* :mod:`app.lab.files` — workspaces, lab files, icons, fs browser, push events
* :mod:`app.lab.images` — Docker image manager endpoints
* :mod:`app.lab.lifecycle` — ``netlab up``/``down``/status + SSE streams

This module keeps the import surface ``main.py`` (and tests) use stable:
``router``, ``runtime_files_router`` and ``fs_router``.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.lab import capture, files, images, lifecycle
from app.lab.files import fs_router, runtime_files_router

router = APIRouter(prefix="/api/lab", tags=["lab"])
router.include_router(capture.router)
router.include_router(files.router)
router.include_router(images.router)
router.include_router(lifecycle.router)

__all__ = ["fs_router", "router", "runtime_files_router"]
