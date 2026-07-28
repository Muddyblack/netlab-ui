from services.netlab.progress import DeploymentProgressTracker


def test_ansible_events_and_recap_update_nodes():
    tracker = DeploymentProgressTracker("up", ["r1", "r2"])
    assert tracker.states == {"r1": "queued", "r2": "queued"}
    assert tracker.feed("changed: [r1]")
    assert tracker.states["r1"] == "configuring"
    assert tracker.feed("r1 : ok=8 changed=2 unreachable=0 failed=0 skipped=1")
    assert tracker.states["r1"] == "ready"
    tracker.feed("fatal: [r2]: FAILED!")
    tracker.finish(1)
    assert tracker.states["r2"] == "failed"


def test_progress_payload_streams_deltas_and_keeps_selected_node_history():
    tracker = DeploymentProgressTracker("initial", ["r1", "r2", "r3"])
    initial = tracker.payload(delta=True)
    assert initial["nodes"] == {"r1": "queued", "r2": "queued", "r3": "queued"}

    assert tracker.feed("TASK [Render interface configuration]")
    task_delta = tracker.payload(delta=True)
    assert task_delta["nodes"] == {}
    assert task_delta["currentTask"] == "Render interface configuration"

    assert tracker.feed("changed: [r2]")
    changed = tracker.payload(delta=True)
    assert changed["nodes"] == {"r2": "configuring"}
    assert changed["summary"]["configuring"] == 1

    tracker.feed("r2 : ok=8 changed=2 unreachable=0 failed=0 skipped=1 rescued=0 ignored=0")
    detail = tracker.node_detail("r2")
    assert detail["state"] == "ready"
    assert detail["currentTask"] == "Render interface configuration"
    assert detail["recap"]["changed"] == 2
    assert [event["status"] for event in detail["events"]] == ["changed", "recap"]


def test_malformed_recap_like_line_is_ignored():
    tracker = DeploymentProgressTracker("up", ["r1"])

    tracker.feed("r1: !:0=" + ("900=" * 10_000))

    assert tracker.payload()["nodes"]["r1"] == "queued"


def test_generic_log_matching_does_not_scan_every_node():
    tracker = DeploymentProgressTracker("up", [f"router{i}" for i in range(10_000)])
    tracker.payload(delta=True)

    assert tracker.feed("Creating router9999 container")
    assert tracker.payload(delta=True)["nodes"] == {"router9999": "creating"}


def test_retained_log_lines_include_their_deployment_section():
    tracker = DeploymentProgressTracker("up", ["r1"])
    tracker.feed("Rendering configuration files")
    tracker.record_log("stdout", "Rendering configuration files")
    tracker.feed("TASK [Configure interfaces]")
    tracker.record_log("stdout", "TASK [Configure interfaces]")

    assert tracker.log_payload()["lines"] == [
        {"stream": "stdout", "line": "Rendering configuration files", "section": "generating"},
        {"stream": "stdout", "line": "TASK [Configure interfaces]", "section": "configuring"},
    ]
