from services.model.topology import Topology
from services.netlab import runner, runtime


def test_interface_rates_are_derived_from_counter_delta(monkeypatch):
    runtime._counter_cache.clear()
    first = {"stats64": {"rx": {"bytes": 100, "packets": 10}, "tx": {"bytes": 200, "packets": 20}}}
    second = {"stats64": {"rx": {"bytes": 200, "packets": 20}, "tx": {"bytes": 400, "packets": 40}}}

    assert "rxBps" not in runtime._stats("c1", "eth1", first, 10.0)
    result = runtime._stats("c1", "eth1", second, 12.0)
    assert result["rxBps"] == 400
    assert result["txBps"] == 800
    assert result["rxPps"] == 5
    assert result["txPps"] == 10


def test_error_and_drop_counters_report_what_is_new():
    runtime._counter_cache.clear()
    first = {"stats64": {"rx": {"bytes": 0, "errors": 1, "dropped": 2}, "tx": {"bytes": 0, "dropped": 0}}}
    second = {"stats64": {"rx": {"bytes": 0, "errors": 4, "dropped": 2}, "tx": {"bytes": 0, "dropped": 3}}}

    assert runtime._stats("c1", "eth1", first, 10.0)["rxDropped"] == 2
    result = runtime._stats("c1", "eth1", second, 12.0)
    assert (result["rxErrors"], result["txDropped"]) == (4, 3)
    assert result["newErrors"] == 6


def test_container_runtime_comes_from_clab_provider_defaults():
    topology = Topology(name="podman", defaults={"providers": {"clab": {"runtime": "podman"}}})

    assert runtime.clab_runtime(topology) == "podman"


def test_preferred_podman_runtime_is_selected_before_docker(monkeypatch):
    binaries = {"podman": "/usr/bin/podman", "docker": "/usr/bin/docker"}
    monkeypatch.setattr(runner.shutil, "which", binaries.get)

    assert runner.container_runtime_binary("podman") == "/usr/bin/podman"
