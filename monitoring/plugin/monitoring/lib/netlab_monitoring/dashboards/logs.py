"""Device and container logs (Loki); only built when logs are enabled."""

from __future__ import annotations

from .panels import LINKS, Board, q, ts, variables

LOKI = {"type": "loki", "uid": "netlab-logs"}
LOG_SELECTOR = '{lab="$lab",node=~"$node"} |~ "(?i)$search"'


def logs() -> dict:
    """Device and container logs (Loki), next to the lab picker; only built when logs are enabled."""
    board = Board("netlab-logs", "netlab logs", "Container logs and syslog of the lab's nodes")
    volume = ts(
        "Log volume",
        [{**q(f"sum by (severity) (count_over_time({LOG_SELECTOR} [$__auto]))", "{{severity}}"), "datasource": LOKI}],
        description="Lines per interval; spikes line up with flaps and config changes.",
        stack=True,
    )
    volume["datasource"] = LOKI
    lines = {
        "type": "logs",
        "title": "Logs",
        "datasource": LOKI,
        "targets": [{"expr": LOG_SELECTOR, "queryType": "range", "datasource": LOKI}],
        "options": {
            "showTime": True,
            "wrapLogMessage": True,
            "sortOrder": "Descending",
            "enableLogDetails": True,
            "dedupStrategy": "none",
        },
    }
    board.add(volume, 24, 6)
    board.add(lines, 24, 18)
    search = {
        "name": "search",
        "label": "Search",
        "type": "textbox",
        "query": "",
        "current": {"text": "", "value": ""},
    }
    return board.build([*variables(with_node=True, multi=True), search], LINKS)
