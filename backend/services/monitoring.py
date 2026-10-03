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
import time
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


def repair_plugin_link() -> bool:
    """Re-point a dangling plugin link at this installation's copy.

    ``~/.netlab`` is shared by everything that runs netlab as this user, e.g. the UI in a
    container and the UI or CLI on the host, while the link target is a path of whichever
    one made it. Left alone, the other one would fail every lab that lists the plugin
    ("Cannot find plugin monitoring"), so each backend fixes the link when it starts. A link
    that works, and a plugin directory the user put there, are left alone; nothing is created
    for someone who never turned monitoring on."""
    link = plugin_link()
    if not link.is_symlink() or link.exists() or plugin_source() is None:
        return False
    install_plugin()
    return True


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


def _settings_keys(attrs: dict[str, Any]) -> list[str]:
    return [key for key in attrs if key == "monitoring" or key.startswith("monitoring.")]


def set_enabled(
    attrs: dict[str, Any], on: bool, where: str | None = None, restore: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Add/remove the plugin in ``plugin:``; ``where`` sets ``monitoring.placement``.

    netlab only accepts the ``monitoring:`` settings while the plugin is listed (the plugin
    registers the attribute), so switching it off takes them out of the topology and returns
    them for the caller to keep; switching it on puts back what ``restore`` holds, unless the
    topology already has settings of its own."""
    plugins = [p for p in _plugins(attrs) if p != PLUGIN]
    if on:
        plugins.append(PLUGIN)
    if plugins:
        attrs["plugin"] = plugins
    else:
        attrs.pop("plugin", None)
    if not on:
        return {key: attrs.pop(key) for key in _settings_keys(attrs)}
    if restore and not _settings_keys(attrs):
        attrs.update(restore)
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
    return {}


def _section(attrs: dict[str, Any], *path: str) -> Any:
    """``attrs['monitoring'][path...]``, also reading netlab's dotted-key spelling of the same."""
    node: Any = attrs.get("monitoring")
    for key in path:
        node = node.get(key) if isinstance(node, dict) else None
    return node if node is not None else attrs.get(".".join(("monitoring", *path)))


def logs_enabled(attrs: dict[str, Any]) -> bool:
    return bool(_section(attrs, "logs", "enabled"))


def notify_targets(attrs: dict[str, Any]) -> dict[str, Any]:
    """Where firing alerts are sent: ``webhook`` and ``slack`` URLs (empty when unset), and
    whether an ``email`` target exists (edited in the topology, not in the UI)."""
    notify = _section(attrs, "alerts", "notify")
    notify = notify if isinstance(notify, dict) else {}
    return {
        "webhook": str(notify.get("webhook") or ""),
        "slack": str(notify.get("slack") or ""),
        "email": bool(notify.get("email")),
    }


def set_options(
    attrs: dict[str, Any], logs: bool | None = None, webhook: str | None = None, slack: str | None = None
) -> None:
    """Set the opt-in parts of the stack. ``None`` leaves a setting as it is; an empty URL removes it."""
    for name, url in (("webhook", webhook), ("slack", slack)):
        if url and not url.startswith(("http://", "https://")):
            raise ValueError(f"the {name} address must be an http(s) URL")
    cfg = attrs.get("monitoring") if isinstance(attrs.get("monitoring"), dict) else {}
    if logs is not None:
        attrs.pop("monitoring.logs.enabled", None)
        section = cfg.get("logs") if isinstance(cfg.get("logs"), dict) else {}
        if logs:
            section["enabled"] = True
        else:
            section.pop("enabled", None)
        cfg["logs"] = section
    if webhook is not None or slack is not None:
        attrs.pop("monitoring.alerts.notify", None)
        alerts = cfg.get("alerts") if isinstance(cfg.get("alerts"), dict) else {}
        notify = alerts.get("notify") if isinstance(alerts.get("notify"), dict) else {}
        for name, url in (("webhook", webhook), ("slack", slack)):
            if url is None:
                continue
            if url:
                notify[name] = url
            else:
                notify.pop(name, None)
        alerts["notify"] = notify
        cfg["alerts"] = alerts
    # Leave no empty containers behind in the user's topology file.
    if not cfg.get("logs"):
        cfg.pop("logs", None)
    if not (cfg.get("alerts") or {}).get("notify"):
        (cfg.get("alerts") or {}).pop("notify", None)
    if not cfg.get("alerts"):
        cfg.pop("alerts", None)
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


def links(lab_dir: Path) -> list[dict[str, str]]:
    """The lab's links with both ends (netlab names), from the collection plan."""
    plan = _read_json(lab_dir / "monitoring" / "plan.json")
    result = []
    for link in plan.get("links") or []:
        if isinstance(link, dict) and link.get("a_node"):
            result.append({k: str(link.get(k) or "") for k in ("link", "a_node", "a_ifname", "b_node", "b_ifname")})
    return result


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


def _http_json(
    url: str,
    *,
    data: dict | None = None,
    auth: tuple[str, str] | None = None,
    timeout: float = 5.0,
    method: str | None = None,
) -> Any:
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, data=body, method=method or ("POST" if body else "GET"))
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


async def query_logs(lab_dir: Path, logql: str, minutes: float = 15, limit: int = 100) -> list[dict[str, Any]]:
    """LogQL query against the lab's log store (newest first). Needs ``monitoring.logs.enabled``."""
    loki = str(stack(lab_dir).get("loki_url") or "")
    if not loki.startswith(("http://", "https://")):
        raise RuntimeError("logs are not enabled for this lab (monitoring.logs.enabled: true)")
    now = time.time()
    params = {
        "query": logql,
        "limit": max(1, min(int(limit), 500)),
        "start": int((now - minutes * 60) * 1e9),
        "end": int(now * 1e9),
        "direction": "backward",
    }
    try:
        data = await asyncio.to_thread(_http_json, f"{loki}/loki/api/v1/query_range?{urllib.parse.urlencode(params)}")
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise RuntimeError(f"log store not reachable: {exc}") from exc
    if not isinstance(data, dict) or data.get("status") != "success":
        raise RuntimeError(str((data or {}).get("message") or "query failed"))
    lines = [
        {"time": float(ts) / 1e9, "node": (s.get("stream") or {}).get("node", ""), "line": line}
        for s in (data.get("data") or {}).get("result") or []
        for ts, line in s.get("values") or []
    ]
    return sorted(lines, key=lambda x: -x["time"])[: params["limit"]]


async def query_range(lab_dir: Path, promql: str, start: float, end: float, step: float) -> list[dict[str, Any]]:
    """PromQL range query: each series with its [time, value] points."""
    params = {"query": promql, "start": f"{start:.3f}", "end": f"{end:.3f}", "step": f"{max(step, 1):g}s"}
    url = f"{_tsdb_url(stack(lab_dir))}/api/v1/query_range?{urllib.parse.urlencode(params)}"
    try:
        data = await asyncio.to_thread(_http_json, url)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise RuntimeError(f"metrics store not reachable: {exc}") from exc
    if not isinstance(data, dict) or data.get("status") != "success":
        raise RuntimeError(str((data or {}).get("error") or "query failed"))
    result = (data.get("data") or {}).get("result") or []
    return [
        {"labels": item.get("metric") or {}, "points": [[float(t), float(v)] for t, v in item.get("values") or []]}
        for item in result
        if isinstance(item, dict)
    ]


def grafana_links(lab_dir: Path, start: float | None = None, end: float | None = None) -> dict[str, str]:
    """Dashboard URLs for the lab, optionally zoomed to a time window (epoch seconds)."""
    info = stack(lab_dir)
    base = str(info.get("grafana_url") or "")
    if not base.startswith("http"):
        return {}
    query = {"var-lab": str(info.get("lab") or "")}
    if start is not None:
        query["from"] = str(int(start * 1000))
        query["to"] = str(int((end or time.time()) * 1000)) if end else "now"
    suffix = urllib.parse.urlencode(query)
    return {name: f"{base}/d/{uid}/?{suffix}" for name, uid in (info.get("dashboards") or {}).items()}


async def annotate(lab_dir: Path, text: str, tags: list[str]) -> int | None:
    """Mark an event on the lab's Grafana dashboards (best effort). Returns the annotation id."""
    info = stack(lab_dir)
    base = str(info.get("grafana_url") or "")
    if not base.startswith("http"):
        return None
    auth = (str(info.get("grafana_user") or "admin"), str(info.get("grafana_password") or "admin"))
    try:
        reply = await asyncio.to_thread(
            _http_json, f"{base}/api/annotations", data={"text": text, "tags": ["netlab", *tags]}, auth=auth
        )
    except (OSError, ValueError, urllib.error.URLError):
        return None
    ident = reply.get("id") if isinstance(reply, dict) else None
    return ident if isinstance(ident, int) else None


async def annotate_end(lab_dir: Path, ident: int, text: str) -> bool:
    """Turn a point annotation into a region ending now (an outage from down to up)."""
    info = stack(lab_dir)
    base = str(info.get("grafana_url") or "")
    if not base.startswith("http"):
        return False
    auth = (str(info.get("grafana_user") or "admin"), str(info.get("grafana_password") or "admin"))
    data = {"timeEnd": int(time.time() * 1000), "text": text}
    try:
        await asyncio.to_thread(_http_json, f"{base}/api/annotations/{ident}", data=data, auth=auth, method="PATCH")
    except (OSError, ValueError, urllib.error.URLError):
        return False
    return True


# Links taken down from the UI: (lab dir, node, interface) -> open annotation id
_open_outages: dict[tuple[str, str, str], int] = {}


async def link_event(lab_dir: Path, node: str, interface: str, up: bool) -> None:
    """Show a link taken down and brought back up as one shaded region on the dashboards."""
    key = (str(lab_dir), node, interface)
    what = f"{node} {interface}"
    if not up:
        ident = await annotate(lab_dir, f"{what} down", ["link", node])
        if ident is not None:
            _open_outages[key] = ident
        return
    ident = _open_outages.pop(key, None)
    if ident is None or not await annotate_end(lab_dir, ident, f"{what} down (outage)"):
        await annotate(lab_dir, f"{what} up", ["link", node])


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
        "vxlanUp": f"count(netlab_vxlan_vni_up{{{sel}}} == 1)",
        "vxlanExpected": f"count(netlab_expected_vxlan_vni{{{sel}}})",
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
        "VXLAN": f"netlab_expected_vxlan_vni{{{sel}}} unless on(lab,node,vni) (netlab_vxlan_vni_up{{{sel}}} == 1)",
    }
    missing_results = await asyncio.gather(*(query(lab_dir, q) for q in missing_queries.values()))
    missing = [
        {
            "protocol": proto,
            "node": str(item["labels"].get("node", "")),
            "peer": str(item["labels"].get("peer_node") or item["labels"].get("peer") or ""),
            "detail": str(
                item["labels"].get("ifname")
                or item["labels"].get("peer")
                or (f"VNI {item['labels']['vni']}" if item["labels"].get("vni") else "")
            ),
        }
        for proto, res in zip(missing_queries, missing_results, strict=True)
        for item in res
    ]
    return {**counts, "missing": missing}
