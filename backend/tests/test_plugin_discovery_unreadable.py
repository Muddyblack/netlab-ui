import os
import stat

import pytest

from services.netlab.plugins import iter_plugin_dirs


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores directory permissions")
def test_unreadable_directory_does_not_break_discovery(tmp_path):
    (tmp_path / "good").mkdir()
    (tmp_path / "good" / "__init__.py").write_text("")
    locked = tmp_path / "monitoring" / "data" / "grafana"
    (locked / "csv").mkdir(parents=True)
    locked.chmod(0)
    try:
        found = [plugin_id for plugin_id, _ in iter_plugin_dirs(tmp_path)]
    finally:
        locked.chmod(stat.S_IRWXU)
    assert found == ["good"]
