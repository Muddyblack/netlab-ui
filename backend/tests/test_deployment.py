from services.netlab import deployment


def test_deployment_registry_returns_overview_and_node_detail(tmp_path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: {}\n")
    tracker = deployment.start(topology, "initial", ["r1"])
    tracker.feed("TASK [Configure BGP]")
    tracker.feed("fatal: [r1]: FAILED! => peer is unreachable")
    tracker.finish(1)

    overview = deployment.overview(topology)
    assert overview["available"] is True
    assert overview["summary"]["failed"] == 1
    assert overview["nodes"] == {"r1": "failed"}

    detail = deployment.node_detail(topology, "r1")
    assert detail["lastError"] == "peer is unreachable"
    assert detail["events"][0]["task"] == "Configure BGP"
