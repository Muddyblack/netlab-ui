"""Reshape raw netlab CLI output so it's readable in the lifecycle progress modal.

The frontend modal (from the ``@srl-labs/clab-ui`` package) renders each streamed
line as flat monospace text. It does **not** interpret ANSI escapes and there is
no useful color, so this module does not bother with coloring. What makes raw
netlab output unreadable in a plain-text box is the *shape* of the text:

* every line is prefixed with noise like ``multiserver:  [INFO]`` / ``[INFO]``,
* long comma lists (``nodes: a, b, c, ... +16 more``) wrap across several lines,
* logical sections run together with no separation, and
* on failure, Python dumps a full multi-frame traceback.

:class:`LineFilter` sits between :func:`runner.run_streaming` and the SSE
endpoint. Feed it ``(stream, line)`` tuples in order; it yields cleaned tuples:

* strips ANSI escapes (defensive — in case a build emits them),
* drops the repeated ``<module>:  [LEVEL]`` prefix, keeping a blank line before
  each new top-level section so groups are visually separated, and
* folds a Python traceback into a single concise ``ERROR`` line.

Full node/group lists are preserved verbatim — only the noise prefix and section
spacing change, so no node names are hidden.

It is stateful (tracebacks and section boundaries span lines) and
stream-agnostic. Call :meth:`flush` after the stream closes to emit any
traceback still buffered.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

# netlab log prefix: an optional "module:" then a "[LEVEL]" tag, e.g.
# 'multiserver:  [INFO] ' or '[INFO] '. Captured so we can drop it while keeping
# the message. Indentation *after* the tag ("  groups:") is preserved.
_PREFIX_RE = re.compile(r"^(?:(?P<module>[\w.-]+):\s*)?\[(?P<level>[A-Z]+)\]\s?")

# A Python traceback header, its "  File ..." frame lines, and the final
# "ExceptionType: message" line that states the actual cause.
_TRACEBACK_HEADER = re.compile(r"^\s*Traceback \(most recent call last\):\s*$")
_FRAME_FILE = re.compile(r'^\s*File "[^"]+", line \d+, in ')
_EXCEPTION_LINE = re.compile(r"^(?:[A-Za-z_][\w.]*(?:Error|Exception)|[A-Za-z_][\w.]*): ")


def strip_ansi(text: str) -> str:
    """Remove CSI/OSC ANSI escapes in one linear pass."""
    out: list[str] = []
    index = 0
    while index < len(text):
        if text[index] != "\x1b" or index + 1 >= len(text):
            out.append(text[index])
            index += 1
            continue

        marker = text[index + 1]
        if marker == "[":
            index += 2
            while index < len(text) and not ("@" <= text[index] <= "~"):
                index += 1
            index += index < len(text)
        elif marker == "]":
            index += 2
            while index < len(text):
                if text[index] == "\x07":
                    index += 1
                    break
                if text[index : index + 2] == "\x1b\\":
                    index += 2
                    break
                index += 1
        else:
            index += 2
    return "".join(out)


class LineFilter:
    """Stateful, order-preserving reshaper for streamed ``(stream, line)`` tuples."""

    def __init__(self) -> None:
        self._in_traceback = False
        self._last_frame: str | None = None
        # Whether the previous emitted line was a top-level (non-indented)
        # message — used to decide when to insert a separating blank line.
        self._emitted_any = False

    def feed(self, stream: str, line: str) -> Iterator[tuple[str, str]]:
        """Yield zero or more cleaned ``(stream, line)`` tuples for one input."""
        clean = strip_ansi(line).rstrip("\n")

        if self._in_traceback:
            if _EXCEPTION_LINE.match(clean.strip()):
                self._in_traceback = False
                self._last_frame = None
                yield ("stderr", f"ERROR  {clean.strip()}")
                return
            if _FRAME_FILE.match(clean):
                self._last_frame = clean.strip()
                return
            if clean.strip() == "" or clean.startswith("  "):
                return  # still inside the traceback body
            self._in_traceback = False
            self._last_frame = None
            # fall through — this line is not part of the traceback

        if _TRACEBACK_HEADER.match(clean):
            self._in_traceback = True
            self._last_frame = None
            return

        # Strip the "module:  [LEVEL]" prefix; remember whether the message was
        # indented (a sub-item of the preceding section) before we drop it.
        m = _PREFIX_RE.match(clean)
        if m:
            body = clean[m.end() :]
            is_top_level = not body.startswith((" ", "\t"))
            clean = body
        else:
            is_top_level = not (clean.startswith((" ", "\t")))

        if not clean.strip():
            # Preserve intentional blank lines but never lead with one.
            if self._emitted_any:
                yield (stream, "")
            return

        # Separate top-level sections with a blank line so groups stand apart.
        if is_top_level and self._emitted_any:
            yield (stream, "")
        self._emitted_any = True
        yield (stream, clean)

    def flush(self) -> Iterator[tuple[str, str]]:
        """Emit any traceback still buffered at end-of-stream."""
        if self._in_traceback:
            self._in_traceback = False
            detail = f" ({self._last_frame})" if self._last_frame else ""
            self._last_frame = None
            yield ("stderr", f"ERROR  netlab failed with an unhandled exception{detail}")
