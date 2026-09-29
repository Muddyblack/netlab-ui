import json
import sys
from pathlib import Path

import pytest
import yaml

PLUGIN = Path(__file__).resolve().parents[1] / "plugin" / "monitoring"
FIXTURES = Path(__file__).resolve().parent / "fixtures"

sys.path.insert(0, str(PLUGIN / "lib"))
sys.path.insert(0, str(PLUGIN / "collector"))


@pytest.fixture
def topology() -> dict:
    """netlab's transformed topology of a 3-router FRR lab (OSPF, IS-IS, BGP, BFD) plus a host."""
    return yaml.safe_load((FIXTURES / "lab3-transformed.yml").read_text())


@pytest.fixture
def frr_outputs() -> dict[str, dict[str, str]]:
    """Real FRR 10.4 vty JSON replies captured from the same lab, per router."""
    return {n: json.loads((FIXTURES / "frr" / f"{n}.json").read_text()) for n in ("r1", "r2", "r3")}
