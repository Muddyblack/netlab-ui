from services.netlab import multilab, runner


def _topo(tmp_path, body="name: lab\nnodes: [r1]\n"):
    lab = tmp_path / "lab2"
    lab.mkdir()
    path = lab / "topology.yml"
    path.write_text(body)
    return path


def test_no_conflict_when_nothing_runs(tmp_path):
    plan = multilab.plan(_topo(tmp_path), {})
    assert plan == {"instanceId": "default", "configured": False, "conflict": None, "suggestedMultilabId": None}


def test_redeploy_in_same_directory_is_not_a_conflict(tmp_path):
    path = _topo(tmp_path)
    plan = multilab.plan(path, {"default": {"dir": str(path.parent)}})
    assert plan["conflict"] is None


def test_default_instance_elsewhere_suggests_free_id(tmp_path):
    path = _topo(tmp_path)
    status = {"default": {"dir": "/somewhere/else", "name": "sample"}, "1": {"dir": "/x"}}
    plan = multilab.plan(path, status)
    assert plan["conflict"] == {"instanceId": "default", "directory": "/somewhere/else", "name": "sample"}
    assert plan["suggestedMultilabId"] == 2


def test_configured_id_conflict_has_no_suggestion(tmp_path):
    path = _topo(tmp_path, "name: lab\ndefaults.multilab.id: 3\nplugin: [multilab]\nnodes: [r1]\n")
    plan = multilab.plan(path, {"3": {"dir": "/other"}})
    assert plan["configured"] is True
    assert plan["instanceId"] == "3"
    assert plan["conflict"]["instanceId"] == "3"
    assert plan["suggestedMultilabId"] is None


def test_nested_multilab_id_is_recognised(tmp_path):
    path = _topo(tmp_path, "name: lab\ndefaults:\n  multilab:\n    id: 7\nnodes: [r1]\n")
    assert multilab.configured_instance_id(path) == "7"


def test_free_id_skips_default_management_subnet():
    status = {str(i): {} for i in range(1, 121)}
    assert multilab.free_id(status) == 122


def test_up_argv_carries_multilab_plugin(tmp_path):
    path = _topo(tmp_path)
    args, cwd = runner.lifecycle_argv("up", path, multilab_id=4)
    assert args[-1] == "topology.yml"
    assert args[args.index("--plugin") + 1] == "multilab"
    assert "defaults.multilab.id=4" in args
    assert cwd == path.parent
    # Other actions ignore it.
    assert "--plugin" not in runner.lifecycle_argv("down", path, multilab_id=4)[0]


def test_restart_keeps_the_registered_multilab_id(tmp_path, monkeypatch):
    import asyncio

    from app.lab import lifecycle

    path = _topo(tmp_path)

    async def status(**_kw):
        return {"default": {"dir": "/elsewhere"}, "3": {"dir": str(path.parent)}}

    monkeypatch.setattr(lifecycle.runner, "status_cached", status)
    assert asyncio.run(lifecycle._registered_multilab_id(str(path))) == 3


def test_sequence_stops_at_first_failure(monkeypatch):
    import asyncio

    from app.lab import lifecycle

    async def fake_stream(args, cwd=None):
        yield "stdout", f"ran {args[0]}"
        yield "exit", "1" if args[0] == "down" else "0"

    monkeypatch.setattr(lifecycle.runner, "run_streaming", fake_stream)

    async def collect():
        return [item async for item in lifecycle._run_sequence([(["down"], None), (["up"], None)])]

    assert asyncio.run(collect()) == [("stdout", "ran down"), ("exit", "1")]
