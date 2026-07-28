"""Pre-deployment readiness checklist.

Aggregates *deploy-ability* signals into one view — deliberately reusing what
other panels already compute (image list, multiserver placement, netlab's own
transform warnings) rather than re-deriving them. This is distinct from:

* the **Validation** lens — runtime tests against a *deployed* lab, and
* the **Changes** lens — a diff against the last deployed baseline.

Readiness answers "can this even deploy right now, and what's missing?" — and,
uniquely, explains a failing ``netlab create`` transform instead of dumping raw
stderr.
"""

from __future__ import annotations

import re
from typing import Any

from services.netlab import runner
from services.nodeset import format_nodeset

_MODULE_REMOVAL_RE = re.compile(r"removing '([\w-]+)' from node modules")
_NODE_IN_WARNING_RE = re.compile(r"\bNode ([\w.-]+)\b")


def _check(
    check_id: str,
    category: str,
    title: str,
    status: str,
    detail: str,
    *,
    items: list[str] | None = None,
    hint: str | None = None,
    object_refs: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": check_id,
        "category": category,
        "title": title,
        "status": status,
        "detail": detail,
        "items": items or [],
        "hint": hint,
        "objectRefs": object_refs or [],
    }


def _node_image(node: dict[str, Any]) -> str | None:
    box = node.get("box")
    if isinstance(box, str) and box:
        return box
    clab = node.get("clab")
    image = clab.get("image") if isinstance(clab, dict) else None
    return image if isinstance(image, str) and image else None


def _available_tags(images: list[dict[str, Any]]) -> set[str]:
    tags: set[str] = set()
    for image in images:
        for tag in image.get("repoTags") or []:
            if isinstance(tag, str) and tag and tag != "<none>:<none>":
                tags.add(tag)
                # Also index the bare repo so "ceos:4.34" matches a "ceos" tag.
                tags.add(tag.split(":", 1)[0])
    return tags


_BOILERPLATE = ("Errors encountered while processing", "Cannot proceed beyond this point")


def _transform_failure(stderr: str) -> dict[str, Any]:
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    # netlab diagnostics use taxonomy prefixes (IncorrectValue, MissingValue,
    # FatalError…) rather than the literal word "error", so filter by dropping
    # the generic banner instead of keyword-matching — otherwise the real cause
    # ("IncorrectValue in groups: …") gets discarded.
    meaningful = [line for line in lines if not any(noise in line for noise in _BOILERPLATE)]
    # Headline = first concrete diagnostic; "... " continuation/hint lines and
    # the "Cannot proceed" boilerplate never make good headlines.
    headline = next(
        (line for line in meaningful if not line.startswith("...")),
        meaningful[0] if meaningful else (lines[0] if lines else "netlab could not process this topology."),
    )
    return _check(
        "transform",
        "Topology",
        "Topology does not transform",
        "fail",
        headline,
        items=meaningful[:10],
        hint="Fix these before deploying — netlab create must succeed first.",
    )


async def build_readiness(topology_path: str) -> dict[str, Any]:
    try:
        artifact = await runner.create(topology_path)
    except runner.NetlabError as exc:
        failure = _transform_failure(exc.stderr or str(exc))
        return {"ready": False, "summary": {"passed": 0, "warn": 0, "fail": 1}, "checks": [failure]}

    snapshot = artifact.get("snapshot") if isinstance(artifact, dict) else {}
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    stderr = str(artifact.get("stderr") or "")
    nodes = snapshot.get("nodes") if isinstance(snapshot.get("nodes"), dict) else {}
    provider = str(snapshot.get("provider") or "")
    checks: list[dict[str, Any]] = [
        _check("transform", "Topology", "Topology transforms cleanly", "pass", f"{len(nodes)} node(s) resolved.")
    ]

    # ── Provider installed ───────────────────────────────────────────────────
    if provider == "clab":
        if runner.is_containerlab_installed():
            checks.append(
                _check("provider", "Provider", "containerlab is installed", "pass", "clab provider available.")
            )
        else:
            checks.append(
                _check(
                    "provider",
                    "Provider",
                    "containerlab is not installed",
                    "fail",
                    "The topology uses the clab provider but containerlab was not found on PATH.",
                    hint="Install containerlab on the backend host.",
                )
            )
    elif provider:
        checks.append(
            _check("provider", "Provider", f"Provider: {provider}", "info", f"Using the {provider} provider.")
        )

    # ── Node images present locally (clab) ───────────────────────────────────
    if provider == "clab":
        from app.lab.images import list_docker_images

        available = _available_tags(await list_docker_images())
        # Grouped by image, not one line per node — a lab with hundreds/thousands
        # of nodes sharing one image must not turn this into an unreadable wall
        # of near-identical lines.
        missing_by_image: dict[str, list[str]] = {}
        seen_images: set[str] = set()
        for node_name, raw_node in nodes.items():
            image = _node_image(raw_node if isinstance(raw_node, dict) else {})
            if not image:
                continue
            seen_images.add(image)
            if image not in available and image.split(":", 1)[0] not in available:
                missing_by_image.setdefault(image, []).append(node_name)
        if not seen_images:
            pass
        elif missing_by_image:
            missing_node_count = sum(len(names) for names in missing_by_image.values())
            items = [
                f"{image} — {len(node_names)} node(s): {format_nodeset(node_names)}"
                for image, node_names in sorted(missing_by_image.items())
            ]
            checks.append(
                _check(
                    "images",
                    "Images",
                    f"{missing_node_count} node image(s) not found locally",
                    "warn",
                    "These container images are not in the local Docker cache yet.",
                    items=items,
                    hint="Pull or build them (Image Manager) before deploying.",
                    object_refs=[f"node:{name}" for names in missing_by_image.values() for name in names],
                )
            )
        else:
            checks.append(
                _check(
                    "images",
                    "Images",
                    "All node images are present",
                    "pass",
                    f"{len(seen_images)} image(s) available locally.",
                )
            )

    # ── Inactive / removed modules (from netlab's own warnings) ──────────────
    removed: dict[str, set[str]] = {}
    for line in stderr.splitlines():
        module_match = _MODULE_REMOVAL_RE.search(line)
        node_match = _NODE_IN_WARNING_RE.search(line)
        if module_match and node_match:
            removed.setdefault(node_match.group(1), set()).add(module_match.group(1))
    if removed:
        items = [f"{node}: {', '.join(sorted(mods))}" for node, mods in sorted(removed.items())]
        checks.append(
            _check(
                "modules",
                "Modules",
                "Some modules are inactive on nodes",
                "info",
                "netlab removed modules a node does not actually use — usually harmless, but worth confirming.",
                items=items,
                object_refs=[f"node:{node}" for node in removed],
            )
        )

    # ── Worker placement (multiserver) ───────────────────────────────────────
    ms = snapshot.get("multiserver") if isinstance(snapshot.get("multiserver"), dict) else None
    plugins = snapshot.get("plugin") if isinstance(snapshot.get("plugin"), list) else []
    if ms is not None or "multiserver" in plugins:
        from services import multiserver

        _placement, newest = multiserver.resolved_placement(topology_path, ms or {}, str(snapshot.get("name") or ""))
        status = multiserver.placement_status(topology_path, newest)
        if status == "ready":
            checks.append(
                _check(
                    "workers",
                    "Workers",
                    "Worker placement is up to date",
                    "pass",
                    "Generated server-*/ directories match the topology.",
                )
            )
        elif status == "stale":
            checks.append(
                _check(
                    "workers",
                    "Workers",
                    "Worker placement is stale",
                    "warn",
                    "The topology changed since the last create — re-run create to refresh placement.",
                    hint="Open the Workers panel and recreate.",
                )
            )
        else:
            checks.append(
                _check(
                    "workers",
                    "Workers",
                    "Worker placement not generated",
                    "warn",
                    "Multiserver is enabled but no placement has been generated yet.",
                    hint="Run netlab create to place nodes on workers.",
                )
            )

    # ── Resource estimate ────────────────────────────────────────────────────
    node_count = len(nodes)
    resource_status = "warn" if node_count > 50 else "info"
    checks.append(
        _check(
            "resources",
            "Resources",
            f"{node_count} node(s) to deploy",
            resource_status,
            "Each node becomes a container/VM — make sure the host has capacity."
            if resource_status == "warn"
            else f"Roughly {node_count} container(s) on this host.",
        )
    )

    summary = {
        "passed": sum(1 for check in checks if check["status"] == "pass"),
        "warn": sum(1 for check in checks if check["status"] == "warn"),
        "fail": sum(1 for check in checks if check["status"] == "fail"),
    }
    return {"ready": summary["fail"] == 0, "summary": summary, "checks": checks}
