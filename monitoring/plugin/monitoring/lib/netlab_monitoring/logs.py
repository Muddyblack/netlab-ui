"""Logs: Loki stores them, Vector collects them.

Two sources, both labelled with the netlab node name so a log line lines up with the metrics:

* **container logs** of every containerlab node (docker logs) -- nothing to configure on the device;
* **syslog** (UDP) from any device that is pointed at the stack -- the sender is matched by its
  management address, falling back to the hostname in the message.

Opt-in (``monitoring.logs.enabled``): it adds two containers.
"""

from __future__ import annotations

import json


def enabled(cfg: dict) -> bool:
    return bool((cfg.get("logs") or {}).get("enabled"))


def loki_config(cfg: dict, http_port: int, grpc_port: int, storage: str = "/loki") -> dict:
    retention = str((cfg.get("logs") or {}).get("retention") or "168h")
    return {
        "auth_enabled": False,
        "server": {
            "http_listen_address": "127.0.0.1" if cfg.get("placement") != "node" else "0.0.0.0",
            "http_listen_port": http_port,
            "grpc_listen_port": grpc_port,
            "log_level": "warn",
        },
        "common": {
            "instance_addr": "127.0.0.1",
            "path_prefix": storage,
            "storage": {"filesystem": {"chunks_directory": f"{storage}/chunks", "rules_directory": f"{storage}/rules"}},
            "replication_factor": 1,
            "ring": {"kvstore": {"store": "inmemory"}},
        },
        "schema_config": {
            "configs": [
                {
                    "from": "2024-01-01",
                    "store": "tsdb",
                    "object_store": "filesystem",
                    "schema": "v13",
                    "index": {"prefix": "index_", "period": "24h"},
                }
            ]
        },
        "limits_config": {"retention_period": retention, "allow_structured_metadata": True},
        "compactor": {
            "working_directory": f"{storage}/compactor",
            "retention_enabled": True,
            "delete_request_store": "filesystem",
        },
        "analytics": {"reporting_enabled": False},
    }


def _vrl_map(name: str, mapping: dict[str, str]) -> str:
    return f"{name} = {json.dumps(mapping, sort_keys=True)}"


def vector_config(plan: dict, loki: str, syslog_port: int) -> dict:
    """Vector pipeline: syslog + container logs -> node label -> Loki. ``loki`` is host:port."""
    by_ip: dict[str, str] = {}
    by_container: dict[str, str] = {}
    for name, node in plan["nodes"].items():
        if ip := (node.get("mgmt") or {}).get("ipv4"):
            by_ip[str(ip).split("/")[0]] = name
        if container := node.get("container"):
            by_container[container] = name
    sources: dict[str, dict] = {
        "syslog": {"type": "syslog", "address": f"0.0.0.0:{syslog_port}", "mode": "udp"},
    }
    if by_container:
        sources["containers"] = {"type": "docker_logs", "include_containers": sorted(by_container)}
    source = "\n".join(
        [
            _vrl_map("by_ip", by_ip),
            _vrl_map("by_container", by_container),
            'node = "unknown"',
            'container = string(.container_name) ?? ""',
            'if container != "" {',  # a missing key gives null, not an error
            "  found = get(by_container, [container]) ?? null",
            "  if is_string(found) { node = string(found) ?? node }",
            "} else {",
            '  sender = string(.source_ip) ?? ""',
            "  found = get(by_ip, [sender]) ?? null",
            '  host = string(.hostname) ?? ""',
            "  if is_string(found) {",
            "    node = string(found) ?? node",
            '  } else if host != "" {',
            "    node = host",
            "  }",
            "}",
            ".node = node",
            'severity = string(.severity) ?? ""',
            'if severity == "" {',
            '  severity = if .stream == "stderr" { "error" } else { "info" }',
            "}",
            ".severity = severity",
            # Syslog timestamps have no year or zone and lab devices' clocks drift: Loki rejects lines
            # that are too far from now, so stamp them on arrival (container logs keep Docker's time).
            'if .source_type == "syslog" { .timestamp = now() }',
            "",
        ]
    )
    return {
        "sources": sources,
        "transforms": {"netlab": {"type": "remap", "inputs": list(sources), "source": source}},
        "sinks": {
            "loki": {
                "type": "loki",
                "inputs": ["netlab"],
                "endpoint": f"http://{loki}",
                "encoding": {"codec": "text"},
                "labels": {
                    "lab": plan["lab"],
                    "node": "{{ node }}",
                    "severity": "{{ severity }}",
                    "source": "{{ source_type }}",
                },
                "out_of_order_action": "accept",
            }
        },
        "data_dir": "/vector-data",
    }
