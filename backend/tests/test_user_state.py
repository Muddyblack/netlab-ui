import pytest

from services import user_state


@pytest.fixture(autouse=True)
def state_file(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_USER_STATE_FILE", str(tmp_path / "state.json"))


def test_state_is_kept_per_user():
    user_state.put("alice", "pinnedLabs", ["/a.yml"])
    user_state.put("bob", "pinnedLabs", ["/b.yml"])
    user_state.put(None, "recentLabs", ["/c.yml"])

    assert user_state.get_all("alice") == {"pinnedLabs": ["/a.yml"]}
    assert user_state.get_all("bob") == {"pinnedLabs": ["/b.yml"]}
    assert user_state.get_all(None) == {"recentLabs": ["/c.yml"]}


def test_lists_are_deduplicated_and_bounded():
    assert user_state.put("a", "pinnedLabs", ["x", "y", "x"]) == ["x", "y"]
    with pytest.raises(ValueError):
        user_state.put("a", "recentLabs", [str(i) for i in range(13)])


def test_rejects_unknown_keys_and_bad_values():
    with pytest.raises(KeyError):
        user_state.put("a", "anything", [])
    with pytest.raises(ValueError):
        user_state.put("a", "pinnedLabs", "not-a-list")
    with pytest.raises(ValueError):
        user_state.put("a", "exerciseProgress", {"tour": [1]})


def test_progress_round_trips():
    user_state.put("a", "exerciseProgress", {"t1": ["s1", "s2"]})
    assert user_state.get_all("a")["exerciseProgress"] == {"t1": ["s1", "s2"]}
