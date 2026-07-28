"""The read-only guard on node command execution.

This allowlist is what stops a prompt-injected agent from configuring or
wrecking a running lab, so the accept/reject table is the point of the test.
"""

from __future__ import annotations

import asyncio

import pytest

from services.assistant import exec_tool

ACCEPTED = [
    "show ip route",
    "show bgp ipv4 unicast summary",
    "display interface brief",
    "ping 10.0.0.1",
    "traceroute 10.0.0.2",
    "ip route show",
    "vtysh -c show bgp summary",
    "uname -a",
]

REJECTED = [
    "configure terminal",
    "conf t",
    "write memory",
    "show run | include secret",  # pipe
    "show version; reboot",  # chaining
    "show version && rm -rf /",  # chaining
    "show version > /tmp/out",  # redirect
    "echo $(cat /etc/shadow)",  # substitution + not a read verb
    "reload",
    "clear ip bgp *",
    "ip link set eth0 down",
    "ip route add 0.0.0.0/0 via 10.0.0.1",
    "sudo shutdown now",
    "cat /etc/passwd\nreboot",  # newline smuggling
    "",
]


@pytest.mark.parametrize("command", ACCEPTED)
def test_read_only_commands_are_accepted(command):
    assert exec_tool.check_command(command)


@pytest.mark.parametrize("command", REJECTED)
def test_write_and_shell_commands_are_rejected(command):
    with pytest.raises(exec_tool.CommandRejected):
        exec_tool.check_command(command)


def test_ping_is_bounded():
    # An unbounded ping never returns, so the tool call would hang until the
    # timeout instead of answering.
    assert exec_tool.check_command("ping 10.0.0.1") == ["ping", "-c", "4", "10.0.0.1"]
    assert exec_tool.check_command("ping -c 2 10.0.0.1") == ["ping", "-c", "2", "10.0.0.1"]


def test_rejection_message_tells_the_agent_what_to_do():
    with pytest.raises(exec_tool.CommandRejected) as excinfo:
        exec_tool.check_command("configure terminal")
    assert "read-only" in str(excinfo.value) or "propose" in str(excinfo.value)


def test_output_is_truncated():
    assert exec_tool._truncate("x" * 10, limit=4).startswith("xxxx")
    assert "truncated" in exec_tool._truncate("x" * 10, limit=4)


def test_timeout_kills_the_command(monkeypatch, tmp_path):
    class SlowProcess:
        returncode = None
        pid = 4242

        async def communicate(self):
            await asyncio.sleep(10)
            return b"", b""

        async def wait(self):
            self.returncode = -9
            return -9

        def kill(self):
            self.returncode = -9

    async def fake_spawn(args, cwd=None):
        return SlowProcess()

    killed: list[int] = []
    monkeypatch.setattr(exec_tool.runner, "spawn_command", fake_spawn)
    monkeypatch.setattr(exec_tool, "EXEC_TIMEOUT_S", 0.05)
    monkeypatch.setattr(exec_tool.os, "killpg", lambda pid, _sig: killed.append(pid))
    monkeypatch.setattr(exec_tool.os, "getpgid", lambda pid: pid)

    result = asyncio.run(exec_tool.exec_on_node(str(tmp_path / "t.yml"), "r1", "show ip route"))
    assert result["timedOut"] is True
    assert killed == [4242]
