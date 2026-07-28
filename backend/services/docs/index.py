"""Offline netlab documentation access — a stub for now, the grounding source for
the future AI/agent surface.

The intent (see the plan's "AI / agent-ready infrastructure" section): keep a
local, queryable copy of the netlab docs so a later agent can cite real netlab
behavior when generating or debugging labs, without live network calls. This
module is deliberately a thin placeholder today — what matters is that the seam
exists in ``services/`` and the rest of the app does not need to change when it
is fleshed out.
"""

from __future__ import annotations

from pathlib import Path

DOCS_ROOT = Path(__file__).resolve().parents[3] / "docs" / "netlab"


def available() -> bool:
    return DOCS_ROOT.exists()


def search(query: str, limit: int = 5) -> list[dict]:
    """Naive substring search over locally-mirrored docs. Replace with a real
    index (e.g. embeddings) when the AI surface is built."""
    if not available():
        return []
    hits: list[dict] = []
    for md in DOCS_ROOT.rglob("*.md"):
        text = md.read_text(errors="ignore")
        if query.lower() in text.lower():
            idx = text.lower().index(query.lower())
            hits.append(
                {
                    "path": str(md.relative_to(DOCS_ROOT)),
                    "excerpt": text[max(0, idx - 120) : idx + 120],
                }
            )
        if len(hits) >= limit:
            break
    return hits
