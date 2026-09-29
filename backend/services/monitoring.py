"""Lab monitoring: the netlab ``monitoring`` plugin shipped in this repository.

The plugin (``monitoring/plugin/monitoring``) does the work -- it runs inside netlab,
writes ``<lab>/monitoring/`` at ``netlab create`` and starts the stack with the lab
(see monitoring/README.md). This module is the UI side of it:

* install the plugin where netlab finds plugins (a symlink in ``~/.netlab``),
* turn it on or off for a lab (the topology's ``plugin:`` list),
* report the stack's state from ``<lab>/monitoring/stack.json`` and ``plan.json``,
* answer read-only PromQL queries against the lab's metrics store,
* mark events (link down/up from the UI) on the Grafana dashboards.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from services.netlab import runner

PLUGIN = "monitoring"
_REPO_PLUGIN = Path(__file__).resolve().parents[2] / "monitoring" / "plugin" / PLUGIN
PLACEMENTS = ("tool", "node")


def plugin_source() -> Path | None:
    """The plugin directory shipped with this UI (repo checkout or container image)."""
    configured = os.environ.get("NETLAB_APP_MONITORING_PLUGIN")
    for candidate in (Path(configured) if configured else None, _REPO_PLUGIN):
        if candidate and (candidate / "__init__.py").is_file():
            return candidate
    return None


def plugin_link() -> Path:
    return Path.home() / ".netlab" / PLUGIN


def plugin_state() -> dict[str, Any]:
    """Is the plugin where netlab looks for it, and is it ours?"""
    source = plugin_source()
    link = plugin_link()
    installed = (link / "__init__.py").is_file()
    ours = installed and source is not None and link.resolve() == source.resolve()
    return {"available": source is not None, "installed": installed, "managed": ours, "path": str(link)}


def install_plugin() -> dict[str, Any]:
    """Symlink the shipped plugin into ~/.netlab. A plugin directory the user put
    there themselves is left alone (it wins, like any user plugin)."""
    source = plugin_source()
    if source is None:
        raise RuntimeError("This installation does not include the monitoring plugin")
    link = plugin_link()
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() and not link.exists():
        link.unlink()  # dangling link from an older checkout
    if not link.exists():
        link.symlink_to(source, target_is_directory=True)
    return plugin_state()


# ------------------------------------------------------------------ topology


def _plugins(attrs: dict[str, Any]) -> list[str]:
    value = attrs.get("plugin")
    if isinstance(value, str):
        return [value]
    return [str(p) for p in value] if isinstance(value, list) else []


def enabled(attrs: dict[str, Any]) -> bool:
    return PLUGIN in _plugins(attrs)


def placement(attrs: dict[str, Any]) -> str:
    cfg = attrs.get("monitoring")
    value = cfg.get("placement") if isinstance(cfg, dict) else None
    value = value or attrs.get("monitoring.placement")
    return value if value in PLACEMENTS else "tool"


def set_enabled(attrs: dict[str, Any], on: bool, where: str | None = None) -> None:
    """Add/remove the plugin in ``plugin:``; ``where`` sets ``monitoring.placement``."""
    plugins = [p for p in _plugins(attrs) if p != PLUGIN]
    if on:
        plugins.append(PLUGIN)
    if plugins:
        attrs["plugin"] = plugins
    else:
        attrs.pop("plugin", None)
    if where is not None:
        if where not in PLACEMENTS:
            raise ValueError(f"placement must be one of {', '.join(PLACEMENTS)}")
        attrs.pop("monitoring.placement", None)
        cfg = attrs.get("monitoring") if isinstance(attrs.get("monitoring"), dict) else {}
        if where == "tool":
            cfg.pop("placement", None)
        else:
            cfg["placement"] = where
        if cfg:
            attrs["monitoring"] = cfg
        else:
            attrs.pop("monitoring", None)


# ------------------------------------------------------------------ running stack


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def stack(lab_dir: Path) -> dict[str, Any]:
    return _read_json(lab_dir / "monitoring" / "stack.json")


def coverage(lab_dir: Path) -> list[dict[str, Any]]:
    """Per node: how it is monitored (from the collection plan)."""
    plan = _read_json(lab_dir / "monitoring" / "plan.json")
    nodes = plan.get("nodes") if isinstance(plan.get("nodes"), dict) else {}
    return [
        {
            "node": name,
            "device": str(node.get("device") or ""),
            "provider": str(node.get("provider") or ""),
            "methods": [str(m) for m in node.get("methods") or []],
        }
        for name, node in sorted(nodes.items())
    ]


async def running_containers(containers: dict[str, str]) -> dict[str, bool]:
    binary = runner.container_runtime_binary()
    if not containers or not binary:
        return {}
    names = list(containers.values())
    proc = await asyncio.create_subprocess_exec(
        binary,
        "inspect",
        "-f",
        "{{.Name}} {{.State.Running}}",
        *names,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    state = {}
    for line in out.decode().splitlines():
        name, _, running = line.strip().lstrip("/").partition(" ")
        state[name] = running == "true"
    return {role: state.get(name, False) for role, name in containers.items()}


# The stack runs on the lab host / management network: never send these through an
# HTTP(S)_PROXY (urllib does not understand CIDR ranges in NO_PROXY either).
_DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _http_json(url: str, *, data: dict | None = None, auth: tuple[str, str] | None = None, timeout: float = 5.0) -> Any:
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, data=body, method="POST" if body else "GET")
    if body:
        request.add_header("Content-Type", "application/json")
    if auth:
        token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
        request.add_header("Authorization", f"Basic {token}")
    with _DIRECT.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode() or "null")


def _tsdb_url(info: dict[str, Any]) -> str:
    url = str(info.get("tsdb_url") or "")
    if not url.startswith(("http://", "https://")):
        raise RuntimeError("monitoring is not set up for this lab (no monitoring/stack.json)")
    return url


async def query(lab_dir: Path, promql: str) -> list[dict[str, Any]]:
    """Instant PromQL query against the lab's metrics store (read-only API)."""
    url = f"{_tsdb_url(stack(lab_dir))}/api/v1/query?{urllib.parse.urlencode({'query': promql})}"
    try:
        data = await asyncio.to_thread(_http_json, url)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise RuntimeError(f"metrics store not reachable: {exc}") from exc
    if not isinstance(data, dict) or data.get("status") != "success":
        raise RuntimeError(str((data or {}).get("error") or "query failed"))
    result = (data.get("data") or {}).get("result") or []
    return [
        {"labels": item.get("metric") or {}, "value": float(item["value"][1])}
        for item in result
        if isinstance(item, dict) and isinstance(item.get("value"), list)
    ]


async def annotate(lab_dir: Path, text: str, tags: list[str]) -> bool:
    """Mark an event on the lab's Grafana dashboards (best effort)."""
    info = stack(lab_dir)
    base = str(info.get("grafana_url") or "")
    if not base.startswith("http"):
        return False
    url = f"{base}/api/annotations"
    auth = (str(info.get("grafana_user") or "admin"), str(info.get("grafana_password") or "admin"))
    try:
        await asyncio.to_thread(_http_json, url, data={"text": text, "tags": ["netlab", *tags]}, auth=auth)
    except (OSError, ValueError, urllib.error.URLError):
        return False
    return True


async def summary(lab_dir: Path) -> dict[str, Any]:
    """Lab health at a glance: nodes up, sessions/adjacencies up vs what the topology expects."""
    lab = str(stack(lab_dir).get("lab") or "")
    sel = f'lab="{lab}"'
    queries = {
        "nodes": f"count(netlab_node_info{{{sel}}})",
        "nodesUp": f"sum(netlab_node_up{{{sel}}})",
        "bgpUp": f"sum(netlab_bgp_session_up{{{sel}}})",
        "bgpExpected": f"count(netlab_expected_bgp_session{{{sel}}})",
        "ospfUp": f"sum(netlab_ospf_neighbor_up{{{sel}}})",
        "ospfExpected": f"count(netlab_expected_ospf_adjacency{{{sel}}})",
        "isisUp": f"sum(netlab_isis_adjacency_up{{{sel}}})",
        "isisExpected": f"count(netlab_expected_isis_adjacency{{{sel}}})",
    }
    results = await asyncio.gather(*(query(lab_dir, q) for q in queries.values()))
    counts = {key: int(res[0]["value"]) if res else 0 for key, res in zip(queries, results, strict=True)}
    missing_queries = {
        "BGP": f"netlab_expected_bgp_session{{{sel}}} unless on(lab,node,peer,vrf) "
        f"(netlab_bgp_session_up{{{sel}}} == 1)",
        "OSPF": f"netlab_expected_ospf_adjacency{{{sel}}} unless on(lab,node,peer_node,ifname) "
        f"(netlab_ospf_neighbor_up{{{sel}}} == 1)",
        "IS-IS": f"netlab_expected_isis_adjacency{{{sel}}} unless on(lab,node,peer_node,ifname) "
        f"(netlab_isis_adjacency_up{{{sel}}} == 1)",
    }
    missing_results = await asyncio.gather(*(query(lab_dir, q) for q in missing_queries.values()))
    missing = [
        {
            "protocol": proto,
            "node": str(item["labels"].get("node", "")),
            "peer": str(item["labels"].get("peer_node") or item["labels"].get("peer") or ""),
            "detail": str(item["labels"].get("ifname") or item["labels"].get("peer") or ""),
        }
        for proto, res in zip(missing_queries, missing_results, strict=True)
        for item in res
    ]
    return {**counts, "missing": missing}
