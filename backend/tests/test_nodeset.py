from services.nodeset import format_nodeset


def test_consecutive_run_collapses():
    names = [f"KOII1_pc{i}" for i in range(1, 7)]
    assert format_nodeset(names) == "KOII1_pc[1-6]"


def test_gaps_produce_multiple_ranges():
    assert format_nodeset(["n1", "n2", "n3", "n5", "n7", "n8"]) == "n[1-3,5,7-8]"


def test_single_name_has_no_brackets():
    assert format_nodeset(["core-sw"]) == "core-sw"
    assert format_nodeset(["KOII1_pc4"]) == "KOII1_pc4"


def test_multiple_bases_joined():
    assert format_nodeset(["pc1", "pc2", "sw1", "sw3"]) == "pc[1-2], sw[1,3]"


def test_unordered_and_duplicate_input():
    assert format_nodeset(["pc3", "pc1", "pc2", "pc2"]) == "pc[1-3]"


def test_names_without_trailing_digits():
    assert format_nodeset(["alpha", "beta"]) == "alpha, beta"
