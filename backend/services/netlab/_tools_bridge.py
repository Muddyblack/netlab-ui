"""Run netlab's external-tool machinery against a deployed lab's snapshot.

Executed with the Python that owns the resolved netlab (``location.target_python``)
in the lab directory, so it imports netlab's own code and renders tool
commands exactly as ``netlab up``/``netlab down`` do. Only stdlib and netsim
imports — the backend's packages are not on this interpreter's path.

Usage: ``python _tools_bridge.py info`` or ``python _tools_bridge.py up|down <tool>``.
Prints one JSON object on stdout.
"""

import contextlib
import io
import json
import re
import sys


def _name_of(cmd):
    match = re.search(r"--name[ =]+['\"]?([^'\"\s]+)", cmd)
    return match.group(1) if match else None


def main(argv):
    from box import Box
    from netsim.cli import external_commands, load_snapshot
    from netsim.utils import strings

    noise = io.StringIO()
    with contextlib.redirect_stdout(noise), contextlib.redirect_stderr(noise):
        topology = load_snapshot(Box({"quiet": True}), warn_modified=False)
    tools = list((topology.get("tools") or {}).keys())
    loc_addr = external_commands.get_local_addr()
    topology.sys.ipaddr = loc_addr
    topology.sys.ipurl = f"[{loc_addr}]" if ":" in loc_addr else loc_addr
    topology.sys.docker_net = ""
    if external_commands.docker_is_used(topology):
        topology.sys.docker_net = f"--network={topology.addressing.mgmt.get('_network', None) or 'netlab_mgmt'}"

    if argv[0] == "info":
        result = {}
        for tool in tools:
            with contextlib.redirect_stdout(io.StringIO()):
                up = external_commands.get_tool_command(tool, "up", topology, verbose=False) or []
                connect = external_commands.get_tool_command(tool, "connect", topology, verbose=False)
                message = external_commands.get_tool_message(tool, topology)
            rendered = [strings.eval_format(cmd, topology) for cmd in up]
            result[tool] = {
                "message": message or "",
                "containers": [name for name in map(_name_of, rendered) if name],
                "canConnect": bool(connect),
                "canStart": bool(up),
            }
        print(json.dumps({"lab": topology.name, "tools": result}))
        return 0

    action, tool = argv[0], argv[1]
    if tool not in tools:
        print(json.dumps({"ok": False, "output": f"{tool} is not a tool of the deployed lab"}))
        return 1
    output = io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        cmds = external_commands.get_tool_command(tool, action, topology, verbose=True)
        status = external_commands.execute_tool_commands(cmds, topology) if cmds else ""
        message = external_commands.get_tool_message(tool, topology) if action == "up" else None
    ok = status is not None
    print(json.dumps({"ok": ok, "output": (output.getvalue() + (status or "")).strip(), "message": message or ""}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
