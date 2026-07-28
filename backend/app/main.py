"""FastAPI application entrypoint for the netlab APP backend (the netlab adapter
/ BFF). Routers are kept thin; all real logic lives in ``services/``."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.contract.responses import HealthStatus
from app.contract.router import router as contract_router
from app.docs.router import router as docs_router
from app.environment.router import router as environment_router
from app.lab.router import fs_router, runtime_files_router
from app.lab.router import router as lab_router
from app.lenses.router import router as lenses_router
from app.plugins.router import router as plugins_router
from app.schema.router import router as schema_router
from app.shell.ws import router as shell_router
from services import assistant, events
from services.netlab import runner

logger = logging.getLogger(__name__)


def _app_version() -> str:
    """Return the app release identifier.

    Release builds should set NETLAB_GUI_VERSION from the release tag. Local
    builds fall back to git describe so the About dialog shows the actual source
    revision without another committed version file.
    """
    if version := os.environ.get("NETLAB_GUI_VERSION"):
        return version
    try:
        return (
            subprocess.run(
                ["git", "describe", "--tags", "--dirty", "--always"],
                capture_output=True,
                check=False,
                cwd=Path(__file__).resolve().parents[2],
                text=True,
                timeout=2,
            ).stdout.strip()
            or "dev"
        )
    except (OSError, subprocess.SubprocessError):
        return "dev"


APP_VERSION = _app_version()


# Optional AI assistant (see services/assistant/). Absent dependencies or
# NETLAB_APP_ASSISTANT=off must leave the rest of the backend untouched, so the
# import is guarded exactly like watchfiles in services/events.py.
_assistant_router = None
_assistant_mcp = None
if assistant.assistant_enabled():
    try:
        from app.assistant.router import router as _assistant_router
        from services.assistant import mcp_server as _assistant_mcp
    except ImportError:  # pragma: no cover - depends on the install extra
        logging.getLogger(__name__).warning("assistant enabled but its dependencies are missing", exc_info=True)
        _assistant_router = None
        _assistant_mcp = None


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Push file-change events to connected UIs (no-op if watchfiles is absent).
    watcher = asyncio.create_task(events.watch_workspaces())
    try:
        if _assistant_mcp is not None:
            # A mounted sub-app's lifespan is not run by Starlette, so the MCP
            # session manager has to be entered here.
            async with _assistant_mcp.session_manager():
                yield
        else:
            yield
    finally:
        if _assistant_router is not None:
            await _assistant_router_shutdown()
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher


async def _assistant_router_shutdown() -> None:
    from app.assistant.router import shutdown

    await shutdown()


# No custom default_response_class: this FastAPI version serializes routes
# with a response_model straight to JSON bytes via Pydantic, which is already
# faster than orjson-wrapping (ORJSONResponse is deprecated upstream).
app = FastAPI(title="netlab APP backend", version=APP_VERSION, lifespan=_lifespan)

# The frontend is served from a separate Vite dev server in development.
# This backend can deploy labs and open shells into nodes, so it must not be
# drivable from arbitrary web origins (drive-by localhost requests / DNS
# rebinding): allow only local dev origins by default, overridable via a
# comma-separated NETLAB_GUI_CORS_ORIGINS for remote/multi-host setups.
_cors_origins = [o.strip() for o in os.environ.get("NETLAB_GUI_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=None if _cors_origins else r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


# Filesystem errors (e.g. a sidecar file owned by another user) must become a
# real JSON response: handlers registered here run inside the middleware stack,
# so CORS headers are attached — an unhandled exception bypasses CORSMiddleware
# and the browser reports an opaque CORS failure instead of the actual cause.
@app.exception_handler(OSError)
async def _os_error_handler(_request: Request, exc: OSError) -> JSONResponse:
    logger.exception("Unhandled filesystem error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "A filesystem operation failed."})


app.include_router(contract_router)
app.include_router(lab_router)
app.include_router(lenses_router)
app.include_router(runtime_files_router)
app.include_router(fs_router)
app.include_router(shell_router)
app.include_router(plugins_router)
app.include_router(schema_router)
app.include_router(docs_router)
app.include_router(environment_router)

if _assistant_router is not None and _assistant_mcp is not None:
    app.include_router(_assistant_router)
    # Agent CLIs (and any MCP client the user points at this lab) attach here.
    _assistant_mcp.install(app)


@app.get("/api/health", response_model=HealthStatus)
async def health():
    netlab_version = runner.cached_version()
    containerlab_present = runner.is_containerlab_installed()
    libvirt_present = runner.is_libvirt_installed()
    return {
        "ok": True,
        "appVersion": APP_VERSION,
        "netlab": runner.is_installed(),
        "containerlab": containerlab_present,
        "libvirt": libvirt_present,
        "netlabVersion": netlab_version,
        "containerlabVersion": runner.containerlab_version() if containerlab_present else None,
        "libvirtVersion": runner.libvirt_version() if libvirt_present else None,
        "netlabVersionSupported": runner.version_at_least(netlab_version) if netlab_version else None,
        "minNetlabVersion": runner.MIN_NETLAB_VERSION,
        "netlabComponents": runner.cached_version_components(),
    }


# In dev, the frontend runs on its own Vite server (:5173) and CORS above
# covers it. In the single-container deployment, `npm run build` output is
# baked into the image and this backend serves it directly on the same port
# as the API — no separate frontend process, no CORS needed. Mounted last so
# it never shadows an /api/* route: Starlette matches routes in registration
# order, and this StaticFiles mount only catches what nothing above matched.
_frontend_dist = Path(os.environ.get("FRONTEND_DIST_DIR", "/app/frontend_dist"))
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
