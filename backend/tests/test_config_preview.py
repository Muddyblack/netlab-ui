from services.netlab.config_preview import MAX_FILE_BYTES, read_node_files


def test_reads_text_node_files_and_preserves_boundaries(tmp_path):
    topology = tmp_path / "lab.yml"
    topology.write_text("nodes: {r1: {}}\n")
    node_dir = tmp_path / "node_files" / "r1"
    (node_dir / "modules").mkdir(parents=True)
    (node_dir / "initial.cfg").write_text("hostname r1\n")
    (node_dir / "modules" / "ospf.cfg").write_text("router ospf\n")
    (node_dir / "binary").write_bytes(b"abc\0def")

    assert read_node_files(topology, "r1") == [
        {"path": "initial.cfg", "content": "hostname r1\n"},
        {"path": "modules/ospf.cfg", "content": "router ospf\n"},
    ]


def test_skips_oversized_files(tmp_path):
    topology = tmp_path / "lab.yml"
    node_dir = tmp_path / "node_files" / "r1"
    node_dir.mkdir(parents=True)
    (node_dir / "huge.cfg").write_bytes(b"x" * (MAX_FILE_BYTES + 1))

    assert read_node_files(topology, "r1") == []
