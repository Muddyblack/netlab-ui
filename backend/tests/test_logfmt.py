"""Tests for the netlab output reshaper (services/netlab/logfmt.py)."""

from services.netlab.logfmt import LineFilter, strip_ansi


def run(lines: list[tuple[str, str]]) -> list[str]:
    fmt = LineFilter()
    out: list[str] = []
    for stream, line in lines:
        out.extend(line for _, line in fmt.feed(stream, line))
    out.extend(line for _, line in fmt.flush())
    return out


def test_strip_ansi_removes_color_codes():
    assert strip_ansi("\x1b[32mINFO\x1b[0m ready") == "INFO ready"


def test_strip_ansi_handles_long_unterminated_escape_in_linear_pass():
    assert strip_ansi("\x1b]" + ("x" * 100_000)) == ""


def test_module_level_prefix_is_dropped():
    out = run([("stdout", 'multiserver:  [INFO] Server "srv1" (192.168.168.128): 22 nodes\n')])
    assert out == ['Server "srv1" (192.168.168.128): 22 nodes']


def test_bare_level_prefix_is_dropped():
    out = run([("stdout", "[INFO] Replicated on all servers: cadvisor\n")])
    assert out == ["Replicated on all servers: cadvisor"]


def test_indented_subitem_keeps_indent():
    out = run(
        [
            ("stdout", 'multiserver:  [INFO] Server "srv1": 22 nodes\n'),
            ("stdout", "multiserver:  [INFO]   groups: hub1, hub3\n"),
        ]
    )
    assert out == ['Server "srv1": 22 nodes', "  groups: hub1, hub3"]


def test_top_level_sections_get_blank_line_between():
    out = run(
        [
            ("stdout", 'multiserver:  [INFO] Server "srv1": 22 nodes\n'),
            ("stdout", "multiserver:  [INFO]   groups: hub1, hub3\n"),
            ("stdout", 'multiserver:  [INFO] Server "srv2": 20 nodes\n'),
        ]
    )
    assert out == [
        'Server "srv1": 22 nodes',
        "  groups: hub1, hub3",
        "",
        'Server "srv2": 20 nodes',
    ]


def test_long_list_is_preserved_verbatim():
    # Node/group names are never truncated — the whole list survives.
    out = run([("stdout", "multiserver:  [INFO]   groups: a, b, c, d, e, f\n")])
    assert out == ["  groups: a, b, c, d, e, f"]


def test_netlab_plus_more_tail_left_untouched():
    out = run([("stdout", "multiserver:  [INFO]   nodes:  n1, n2, n3, ... +16 more\n")])
    assert out == ["  nodes:  n1, n2, n3, ... +16 more"]


def test_traceback_is_folded_into_one_error_line():
    lines = [
        ("stdout", "multiserver:  [INFO] 3 cross-server links\n"),
        ("stderr", "Traceback (most recent call last):\n"),
        ("stderr", '  File "/x/bin/netlab", line 15, in <module>\n'),
        ("stderr", "    netsim.cli.lab_commands(__file__)\n"),
        ("stderr", '  File "/x/netsim/cli/create.py", line 183, in run\n'),
        ("stderr", "    raise ValueError(msg)\n"),
        ("stderr", "ValueError: cross-server links need a shared VLAN\n"),
    ]
    out = run(lines)
    assert "3 cross-server links" in out
    assert not any("File " in line for line in out)
    assert "ERROR  ValueError: cross-server links need a shared VLAN" in out


def test_unterminated_traceback_flushed():
    lines = [
        ("stderr", "Traceback (most recent call last):\n"),
        ("stderr", '  File "/x/create.py", line 10, in run\n'),
    ]
    out = run(lines)
    assert len(out) == 1
    assert out[0].startswith("ERROR  netlab failed with an unhandled exception")
    assert "create.py" in out[0]
