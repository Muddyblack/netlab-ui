from services.model import serialize


def test_dotted_defaults_are_visible_through_topology_default():
    dotted = serialize.from_yaml("defaults.device: linux\nnodes: [h1]\n")
    nested = serialize.from_yaml("defaults:\n  device: eos\nnodes: [r1]\n")
    assert dotted.default("device") == "linux"
    assert nested.default("device") == "eos"
    assert serialize.from_yaml("nodes: [x]\n").default("device") is None
