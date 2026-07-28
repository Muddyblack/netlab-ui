import os

from app.environment import router


def test_resolve_candidate_rejects_arbitrary_executable(tmp_path):
    executable = tmp_path / "not-netlab"
    executable.write_text("#!/bin/sh\nexit 0\n")
    executable.chmod(0o700)

    assert router._resolve_candidate(str(executable)) is None


def test_resolve_candidate_accepts_executable_named_netlab(tmp_path):
    executable = tmp_path / "netlab"
    executable.write_text("#!/bin/sh\nexit 0\n")
    executable.chmod(0o700)

    assert router._resolve_candidate(str(executable)) == os.path.realpath(executable)
