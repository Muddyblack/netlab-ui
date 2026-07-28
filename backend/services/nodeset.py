"""Collapse similar node names into hostlist / nodeset notation.

Mirrors the frontend ``NodeSetChips`` so long lists of near-identical nodes stay
compact wherever the backend emits them as text::

    KOII1_pc1 … KOII1_pc6   -> KOII1_pc[1-6]
    with gaps               -> KOII1_pc[1-3,5,7-8]
    unrelated names         -> joined with ", "

A "base" is everything before a name's trailing digit run; names sharing a base
are range-collapsed, names without trailing digits stay standalone.
"""

from __future__ import annotations

import re

_TRAILING_DIGITS = re.compile(r"^(.*?)(\d+)$")


def format_nodeset(names: list[str]) -> str:
    seen: set[str] = set()
    order: list[tuple[str, str]] = []  # (kind, key), kind in {"num", "plain"}
    buckets: dict[str, list[tuple[int, str]]] = {}

    for name in names:
        if name in seen:
            continue
        seen.add(name)
        match = _TRAILING_DIGITS.match(name)
        if match is None:
            order.append(("plain", name))
            continue
        base = match.group(1)
        if base not in buckets:
            buckets[base] = []
            order.append(("num", base))
        buckets[base].append((int(match.group(2)), match.group(2)))

    parts: list[str] = []
    for kind, key in order:
        if kind == "plain":
            parts.append(key)
            continue
        entries = sorted(buckets[key])
        if len(entries) == 1:
            parts.append(f"{key}{entries[0][1]}")
            continue
        ranges: list[str] = []
        run_start = 0
        for i in range(1, len(entries) + 1):
            if i == len(entries) or entries[i][0] != entries[i - 1][0] + 1:
                start_num, start_str = entries[run_start]
                end_num, end_str = entries[i - 1]
                ranges.append(start_str if start_num == end_num else f"{start_str}-{end_str}")
                run_start = i
        parts.append(f"{key}[{','.join(ranges)}]")
    return ", ".join(parts)
