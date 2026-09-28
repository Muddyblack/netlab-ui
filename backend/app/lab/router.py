"""Aggregator for the ``/api/lab`` surface.

The actual endpoints live in sibling modules, grouped by concern:

* :mod:`app.lab.broadcast` — run a command on several nodes, saved scripts
* :mod:`app.lab.capture` — Edgeshark install/uninstall + Wireshark VNC capture
* :mod:`app.lab.pcap` — pcap download / live stream without Edgeshark
* :mod:`app.lab.configs` — running-config snapshots, drift and diffs
* :mod:`app.lab.custom_configs` — custom config templates (``config: [name]``)
* :mod:`app.lab.files` — workspaces, lab files, icons, fs browser, push events
* :mod:`app.lab.lab_copy` — copy / fork / publish a lab into a workspace
* :mod:`app.lab.images` — Docker image manager endpoints
* :mod:`app.lab.lifecycle` — ``netlab up``/``down``/status + SSE streams
* :mod:`app.lab.tools` — netlab external tools (Graphite, SuzieQ, …)

This module keeps the import surface ``main.py`` (and tests) use stable:
``router``, ``runtime_files_router`` and ``fs_router``.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.lab import broadcast, capture, configs, custom_configs, files, images, lab_copy, lifecycle, pcap, tools
from app.lab.files import fs_router, runtime_files_router

router = APIRouter(prefix="/api/lab", tags=["lab"])
router.include_router(broadcast.router)
router.include_router(capture.router)
router.include_router(configs.router)
router.include_router(custom_configs.router)
router.include_router(pcap.router)
router.include_router(files.router)
router.include_router(images.router)
router.include_router(lab_copy.router)
router.include_router(lifecycle.router)
router.include_router(tools.router)

__all__ = ["fs_router", "router", "runtime_files_router"]
