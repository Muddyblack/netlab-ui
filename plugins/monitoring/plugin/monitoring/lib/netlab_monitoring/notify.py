"""Alert notifications: an Alertmanager that forwards firing alerts, only when asked for.

Without a target the alerts stay in vmalert and the ``ALERTS`` metric (no extra container).
Targets, under ``monitoring.alerts.notify``:

* ``webhook``: URL that receives Alertmanager's JSON (scripts, chat bridges, automation);
* ``slack``: an incoming-webhook URL;
* ``email``: ``{to, from, smarthost, username, password}``.
"""

from __future__ import annotations

import typing

EMAIL_KEYS = ("to", "from", "smarthost")


def notify_cfg(cfg: dict) -> dict:
    return (cfg.get("alerts") or {}).get("notify") or {}


def enabled(cfg: dict) -> bool:
    n = notify_cfg(cfg)
    return bool(n.get("webhook") or n.get("slack") or n.get("email"))


def problems(cfg: dict) -> list[str]:
    """What is wrong with the notification settings (empty when fine)."""
    n = notify_cfg(cfg)
    found = []
    for key in ("webhook", "slack"):
        if n.get(key) and not str(n[key]).startswith(("http://", "https://")):
            found.append(f"monitoring.alerts.notify.{key} must be an http(s) URL")
    email = n.get("email")
    if email:
        missing = [k for k in EMAIL_KEYS if not (isinstance(email, dict) and email.get(k))]
        if missing:
            found.append(f"monitoring.alerts.notify.email needs {', '.join(missing)}")
    return found


def alertmanager_config(cfg: dict) -> dict:
    n = notify_cfg(cfg)
    receiver: dict[str, typing.Any] = {"name": "netlab"}
    if n.get("webhook"):
        receiver["webhook_configs"] = [{"url": str(n["webhook"]), "send_resolved": True}]
    if n.get("slack"):
        receiver["slack_configs"] = [
            {
                "api_url": str(n["slack"]),
                "send_resolved": True,
                "title": "{{ .CommonLabels.alertname }} ({{ .Status }})",
                "text": "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}",
            }
        ]
    config: dict[str, typing.Any] = {
        "route": {
            "receiver": "netlab",
            "group_by": ["alertname", "lab", "node"],
            "group_wait": "10s",
            "group_interval": "1m",
            "repeat_interval": "1h",
        },
        "receivers": [receiver],
    }
    if email := n.get("email"):
        receiver["email_configs"] = [{"to": str(email["to"]), "send_resolved": True}]
        config["global"] = {
            "smtp_smarthost": str(email["smarthost"]),
            "smtp_from": str(email["from"]),
            **({"smtp_auth_username": str(email["username"])} if email.get("username") else {}),
            **({"smtp_auth_password": str(email["password"])} if email.get("password") else {}),
        }
    return config
