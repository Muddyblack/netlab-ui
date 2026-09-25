import asyncio

from services.netlab import config_snapshots as snapshots


def test_normalize_drops_volatile_lines():
    raw = (
        "Building configuration...\n\nCurrent configuration:\n!\nhostname r1  \n! Last configuration change at 10:00\n"
    )
    assert snapshots.normalize(raw) == "!\nhostname r1\n"


def test_diff_counts_ignore_volatile_noise():
    assert snapshots.diff_counts("Current configuration:\nhostname r1\n", "hostname r1\n") == (0, 0)
    assert snapshots.diff_counts("a\nb\n", "a\nc\nd\n") == (2, 1)


def test_snapshot_round_trip_drift_and_retention(tmp_path, monkeypatch):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: [r1, h1]\n")
    live = {"r1": "hostname r1\n", "h1": None}

    async def running(_path):
        return ["r1", "h1"]

    async def fetch(_path, nodes):
        return {node: live[node] for node in nodes}

    monkeypatch.setattr(snapshots, "running_nodes", running)
    monkeypatch.setattr(snapshots, "fetch_running", fetch)
    monkeypatch.setattr(snapshots, "KEEP", 2)

    first = asyncio.run(snapshots.take_snapshot(topology, "after netlab up"))
    assert first["nodes"] == ["r1"] and first["skipped"] == ["h1"]
    assert snapshots.read_snapshot(topology, first["id"], "r1") == "hostname r1\n"
    assert snapshots.read_snapshot(topology, "../../etc", "r1") is None

    live["r1"] = "hostname r1\ninterface eth1\n"
    rows = {row["node"]: row for row in asyncio.run(snapshots.drift(topology, first["id"]))}
    assert rows["r1"]["status"] == "changed" and rows["r1"]["added"] == 1
    assert rows["h1"]["status"] == "unavailable"

    for _ in range(3):
        asyncio.run(snapshots.take_snapshot(topology, "manual"))
    listed = snapshots.list_snapshots(topology)
    assert len(listed) == 2 and first["id"] not in {s["id"] for s in listed}
