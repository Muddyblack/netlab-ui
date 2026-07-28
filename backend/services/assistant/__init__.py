"""Optional AI assistant feature.

Everything AI-related lives under this package plus ``app/assistant/`` — the
rest of the backend never imports from here except for the guarded block in
``app.main``. Deleting both directories (and that block) removes the feature
entirely.

The feature is enabled when ``NETLAB_APP_ASSISTANT`` is not ``off`` *and* the
optional ``mcp`` dependency is importable (``pip install -e '.[assistant]'``).
This mirrors the ``watchfiles`` pattern in :mod:`services.events`: an absent
optional dependency degrades to "feature missing", never to a broken backend.
"""

from __future__ import annotations

import importlib.util
import logging

from services.assistant.config import assistant_mode

logger = logging.getLogger(__name__)

_available: bool | None = None


def assistant_enabled() -> bool:
    """True when the assistant router and MCP server should be mounted."""
    global _available
    mode = assistant_mode()
    if mode == "off":
        return False
    if _available is None:
        _available = importlib.util.find_spec("mcp") is not None
        if not _available and mode == "on":
            logger.warning(
                "NETLAB_APP_ASSISTANT=on but the 'mcp' package is missing; install the assistant extra to enable it"
            )
    return _available
