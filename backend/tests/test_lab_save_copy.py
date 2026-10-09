import pytest
from fastapi import HTTPException

from app.lab import common, lifecycle


@pytest.fixture
def lab_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(common.ws_store, "load", lambda: [str(tmp_path)])
    lab = tmp_path / "lab"
    lab.mkdir()
    return lab


def test_no_copy_means_none(lab_dir):
    assert lifecycle._save_copy_dir(lab_dir, None) is None
    assert lifecycle._save_copy_dir(lab_dir, "  ") is None


def test_relative_copy_inside_lab_is_accepted(lab_dir):
    assert lifecycle._save_copy_dir(lab_dir, "saved-configs") == lab_dir.resolve() / "saved-configs"


@pytest.mark.parametrize("bad", ["../escape", "/etc", "a/../../x"])
def test_copy_outside_lab_is_rejected(lab_dir, bad):
    with pytest.raises(HTTPException) as exc:
        lifecycle._save_copy_dir(lab_dir, bad)
    assert exc.value.status_code == 400


def test_symlink_escape_is_rejected(lab_dir, tmp_path):
    outside = tmp_path.parent / "outside-target"
    outside.mkdir(exist_ok=True)
    (lab_dir / "link").symlink_to(outside)
    with pytest.raises(HTTPException):
        lifecycle._save_copy_dir(lab_dir, "link/x")
