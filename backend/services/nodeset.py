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


# ----------------------------------------------------------------- selecting nodes with an expression
#
# The reverse of :func:`format_nodeset`, for "run on ..." style fields where typing every name is
# not an option. A selector is one of (case-insensitive, matched against the lab's node names):
#
#   r[1-3,5]  hostlist        r1-r3, r1-3, leaf01-leaf16   numeric range
#   leaf*  r#  h?  wildcards (* any text, ? one character, # digits), like the bulk-link dialog
#   spine[ab]|border.*        anything with regular-expression syntax (must match the whole name)
#
# Matching walks the existing names, so a range over a hundred thousand numbers costs one pass.

_HOSTLIST = re.compile(r"^(?P<prefix>[^\[\]]*)\[(?P<spec>\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\](?P<suffix>[^\[\]]*)$")
_RANGE = re.compile(r"^(?P<prefix>.*?)(?P<lo>\d+)\s*-\s*(?P=prefix)?(?P<hi>\d+)$")
_WILDCARDS = re.compile(r"[*?#]")
_MAX_EXPRESSION = 200  # node names are short; a longer pattern is a typo or an attempt to stall the matcher
_REGEX_SYNTAX = re.compile(r"[\\()|^$+{}\[\]]")


def _number_test(bounds: list[tuple[str, str]]):
    """Predicate on a digit string: inside one of the ``lo-hi`` bounds (zero-padded bounds fix the width)."""
    spans = []
    for lo_text, hi_text in bounds:
        lo, hi = int(lo_text), int(hi_text)
        padded = (lo_text.startswith("0") and len(lo_text) > 1) or (hi_text.startswith("0") and len(hi_text) > 1)
        spans.append((min(lo, hi), max(lo, hi), len(lo_text) if padded else 0))

    def test(digits: str) -> bool:
        number = int(digits)
        return any(lo <= number <= hi and (not width or len(digits) == width) for lo, hi, width in spans)

    return test


def _numbered(names: list[str], prefix: str, suffix: str, bounds: list[tuple[str, str]]) -> list[str]:
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+){re.escape(suffix)}$", re.IGNORECASE)
    in_range = _number_test(bounds)
    return [name for name in names if (m := pattern.match(name)) and in_range(m.group(1))]


def select(expression: str, names: list[str]) -> list[str] | None:
    """Names matched by a selector expression, or ``None`` when ``expression`` is not a selector
    (a plain name: the caller decides what that means). Raises ``ValueError`` for a broken regex."""
    text = expression.strip()
    if not text:
        return None
    if len(text) > _MAX_EXPRESSION:
        raise ValueError(f"selector is longer than {_MAX_EXPRESSION} characters")
    if hostlist := _HOSTLIST.match(text):
        bounds = [(part.split("-")[0], part.split("-")[-1]) for part in hostlist.group("spec").split(",")]
        return _numbered(names, hostlist.group("prefix"), hostlist.group("suffix"), bounds)
    if _REGEX_SYNTAX.search(text):
        try:
            pattern = re.compile(text, re.IGNORECASE)
        except re.error as exc:
            raise ValueError(f"{text!r} is not a valid pattern: {exc}") from exc
        return [name for name in names if pattern.fullmatch(name)]
    if _WILDCARDS.search(text):
        converted = "".join({"*": ".*", "?": ".", "#": r"\d+"}.get(char, re.escape(char)) for char in text)
        pattern = re.compile(converted, re.IGNORECASE)
        return [name for name in names if pattern.fullmatch(name)]
    if span := _RANGE.match(text):
        return _numbered(names, span.group("prefix"), "", [(span.group("lo"), span.group("hi"))])
    return None
