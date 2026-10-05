"""Grafana: datasources, dashboard providers, the built-in boards and the container environment."""

from __future__ import annotations

import json

import yaml

from . import dashboards, logs
from .endpoints import Endpoints

USER_DASHBOARDS_MOUNT = "/etc/netlab-user-dashboards"


def grafana_files(plan: dict, cfg: dict, ep: Endpoints) -> dict[str, str]:
    datasource = {
        "apiVersion": 1,
        "datasources": [
            {
                "name": "netlab",
                "uid": "netlab",
                "type": "prometheus",
                "access": "proxy",
                "url": f"http://{ep.tsdb}",
                "isDefault": True,
                "editable": False,
                "jsonData": {"timeInterval": f"{int(cfg.get('interval') or 15)}s"},
            }
        ],
    }
    if logs.enabled(cfg):
        datasource["datasources"].append(
            {
                "name": "netlab-logs",
                "uid": "netlab-logs",
                "type": "loki",
                "access": "proxy",
                "url": f"http://{ep.loki}",
                "editable": False,
            }
        )
    provider = {
        "apiVersion": 1,
        "providers": [
            {
                "name": "netlab",
                "folder": "netlab",
                "type": "file",
                "disableDeletion": True,
                "allowUiUpdates": False,
                "options": {"path": "/etc/netlab-dashboards", "foldersFromFilesStructure": False},
            },
            {
                # Dashboards the user drops into <lab>/monitoring/dashboards (Grafana JSON, or
                # compiled from a YAML spec); picked up within seconds and editable in the UI.
                "name": "my-dashboards",
                "folder": "My dashboards",
                "type": "file",
                "disableDeletion": False,
                "allowUiUpdates": True,
                "updateIntervalSeconds": 10,
                "options": {"path": USER_DASHBOARDS_MOUNT, "foldersFromFilesStructure": False},
            },
        ],
    }
    files = {
        "grafana/provisioning/datasources/netlab.yml": yaml.safe_dump(datasource, sort_keys=False),
        "grafana/provisioning/dashboards/netlab.yml": yaml.safe_dump(provider, sort_keys=False),
    }
    for name, board in dashboards.build(plan, cfg).items():
        files[f"grafana/dashboards/{name}.json"] = json.dumps(board, indent=1)
    return files


def grafana_env(cfg: dict, port: int) -> dict[str, str]:
    gcfg = cfg.get("grafana") or {}
    return {
        "GF_SERVER_HTTP_PORT": str(port),
        "GF_AUTH_ANONYMOUS_ENABLED": "true",
        "GF_AUTH_ANONYMOUS_ORG_ROLE": str(gcfg.get("anonymous_role") or "Viewer"),
        "GF_SECURITY_ADMIN_PASSWORD": str(gcfg.get("admin_password") or "admin"),
        "GF_SECURITY_ALLOW_EMBEDDING": "true",
        "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH": "/etc/netlab-dashboards/netlab-overview.json",
        "GF_ANALYTICS_REPORTING_ENABLED": "false",
        "GF_ANALYTICS_CHECK_FOR_UPDATES": "false",
        "GF_NEWS_NEWS_FEED_ENABLED": "false",
        "GF_USERS_DEFAULT_THEME": "system",
    }
