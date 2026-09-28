from services import owners


def test_owner_is_recorded_and_forgotten(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_OWNERS_FILE", str(tmp_path / "owners.json"))
    lab = tmp_path / "lab"
    lab.mkdir()
    status = {"default": {"dir": str(lab), "name": "lab"}, "1": {"dir": str(tmp_path / "other")}}

    owners.record(lab, None)  # no auth, no owner
    assert owners.annotate(status) == status

    owners.record(lab, "alice")
    annotated = owners.annotate(status)
    assert annotated["default"]["owner"] == "alice"
    assert "owner" not in annotated["1"]

    owners.forget(lab)
    assert "owner" not in owners.annotate(status)["default"]
