"""The four endpoints of clab-ui's ``ClabUiHost`` API contract, plus the netlab
source-model REST used by the authoring panels.

clab-ui (via ``createApiClabUiHost``) expects:
  POST   /api/topology/sessions
  DELETE /api/topology/sessions/{id}
  POST   /api/topology/snapshot
  POST   /api/topology/command

The authoring panels (Defaults/Templates/Groups/Nodes/Links) drive the same
underlying model through ``/api/topology/model`` so canvas and panels never go
out of sync.

Split by domain across this package's modules (sessions, model, templates,
groups, multiserver, custom_nodes), all registering onto the one shared
``router`` from ``_shared.py`` — importing them here (for their route
registration side effects) is what actually wires up the API.
"""

from __future__ import annotations

from app.contract.router import (  # noqa: F401
    custom_nodes,
    groups,
    model,
    multiserver,
    sessions,
    templates,
)
from app.contract.router._shared import router

__all__ = ["router"]
