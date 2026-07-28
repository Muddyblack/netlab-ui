from services.netlab import deploy_diff


def test_compare_tracks_changes_since_recorded_deploy(tmp_path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes:\n  r1:\n")

    assert deploy_diff.compare(topology)["baselineExists"] is False
    deploy_diff.record(topology)
    assert deploy_diff.compare(topology)["changed"] is False

    topology.write_text("nodes:\n  r1:\n  r2:\n")
    result = deploy_diff.compare(topology)
    assert result["changed"] is True
    assert "+  r2:" in result["diff"]
