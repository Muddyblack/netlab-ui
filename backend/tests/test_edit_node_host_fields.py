from app.contract import commands
from services.model import serialize


def _lab(tmp_path, body: str):
    path = tmp_path / "topology.yml"
    path.write_text(body)
    return str(path)


def test_host_fields_replace_the_netlab_attributes(tmp_path):
    src = "name: t\nnodes:\n  r1:\n    device: frr\n    role: gateway\n    module: [ospf, bgp]  # routing\n"
    path = _lab(tmp_path, src)
    host_fields = {"role": "router", "module": ["ospf"]}
    commands.apply(path, {"command": "editNode", "payload": {"id": "r1", "extraData": {"hostFields": host_fields}}})
    text = (tmp_path / "topology.yml").read_text()
    node = serialize.from_yaml(text).node("r1")
    assert node.attrs == {"role": "router", "module": ["ospf"]}
    assert node.device == "frr"
    assert "# routing" in text


def test_resolved_default_image_is_not_pinned(tmp_path, monkeypatch):
    monkeypatch.setattr(commands, "_is_default_image", lambda _device, image: image == "default:1")
    path = _lab(tmp_path, "name: t\nnodes:\n  r1:\n    device: frr\n")
    commands.apply(path, {"command": "editNode", "payload": {"id": "r1", "extraData": {"image": "default:1"}}})
    assert "image" not in serialize.from_yaml((tmp_path / "topology.yml").read_text()).node("r1").attrs
    commands.apply(path, {"command": "editNode", "payload": {"id": "r1", "extraData": {"image": "mine:2"}}})
    assert serialize.from_yaml((tmp_path / "topology.yml").read_text()).node("r1").attrs["image"] == "mine:2"
