"""Stable canvas ids for topology links.

The canvas gets its edges from two interchangeable projections — the
``netlab create -o clab`` transform and the raw netlab model (see
``app/contract/snapshot.py``) — and the Lens overlays bind their own analysis
back onto those same edges by id. All three have to agree, and an id has to
survive an edit.

Index-based ids (``e0``, ``e1``, …) fail both requirements: deleting one link
renumbers every link after it, which drops React Flow's element identity
(selection, hover and in-place updates all reset) and silently re-points
edge-keyed annotations at a different link. They also make the two projections
disagree whenever one emits links in a different order than the other, so the
canvas cannot tell that an edge in the new projection *is* an edge it is
already rendering.

Deriving the id from the endpoint pair fixes both. The node pair is the only
identity every projection shares — interface names are assigned by
``netlab create`` and are absent from the raw model — and it does not move when
unrelated links change.
"""

from __future__ import annotations

# Accumulates how many times each node pair has been seen during a single
# projection pass, so parallel links get distinct suffixes.
EdgeIdCounter = dict[tuple[str, str], int]


def edge_id(source: str, target: str, seen: EdgeIdCounter) -> str:
    """Stable canvas id for the link between ``source`` and ``target``.

    The pair is sorted, so the id is orientation-independent: a projection that
    emits ``r2 → r1`` for what the model authored as ``r1 - r2`` still lands on
    the same id. ``source``/``target`` on the edge itself keep the authored
    orientation — only the id is normalized.

    Pass one ``seen`` dict through every edge of a single projection: parallel
    links between the same pair are then numbered ``a--b``, ``a--b#2``, … in
    projection order. Two projections agree on those suffixes as long as they
    emit parallel links in the same relative order, which is the best that can
    be done without an identity netlab itself does not expose.
    """
    key = (source, target) if source <= target else (target, source)
    seen[key] = occurrence = seen.get(key, 0) + 1
    base = f"{key[0]}--{key[1]}"
    return base if occurrence == 1 else f"{base}#{occurrence}"
