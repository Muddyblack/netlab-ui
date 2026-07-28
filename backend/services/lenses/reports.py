"""Netlab report discovery and structured, searchable report rendering."""

from __future__ import annotations

import asyncio
import ipaddress
import re
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from services.netlab import runner

from .service import bundle_for

_REPORT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_MAX_REPORT_BYTES = 2 * 1024 * 1024
_REPORT_TIMEOUT_SECONDS = 45


def _descriptor(name: str, description: str, source: str = "system") -> dict[str, Any]:
    if name == "addressing.md":
        adapter = "addressing"
    elif name in {"bgp-neighbor.md", "bgp-neighbor-short.md"}:
        adapter = "bgp-neighbor"
    else:
        adapter = None
    return {
        "id": name,
        "name": name.removesuffix(".md").replace("-", " ").title(),
        "description": description,
        "format": "table" if adapter else "markdown",
        "source": "builtin" if adapter else source,
        "structuredAdapter": adapter,
    }


async def catalog(topology_path: str) -> list[dict[str, Any]]:
    path = Path(topology_path)
    result = await runner.run_command(["show", "reports", "--format", "yaml"], cwd=path.parent)
    if result.code != 0:
        raise runner.NetlabError(["netlab", "show", "reports"], result.code, result.stderr or result.stdout)
    parsed = YAML(typ="safe").load(result.stdout) or {}
    markdown = parsed.get("md") if isinstance(parsed, dict) else {}
    descriptors: list[dict[str, Any]] = []
    for _key, raw in markdown.items() if isinstance(markdown, dict) else []:
        item = raw if isinstance(raw, dict) else {}
        name = str(item.get("name") or "")
        if not _REPORT_ID.fullmatch(name):
            continue
        workspace_template = path.parent / "reports" / f"{name}.j2"
        source = "workspace" if workspace_template.exists() else "system"
        descriptors.append(_descriptor(name, str(item.get("desc") or ""), source))
    return sorted(descriptors, key=lambda item: (0 if item["structuredAdapter"] else 1, item["name"]))


def _clean_cell(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " / ", value, flags=re.IGNORECASE)
    value = value.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", value).strip()


def parse_markdown_tables(markdown: str) -> list[dict[str, Any]]:
    lines = markdown.splitlines()
    tables: list[dict[str, Any]] = []
    title = ""
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if line.startswith("#"):
            title = line.lstrip("#").strip()
            index += 1
            continue
        if line.startswith("|") and index + 1 < len(lines) and re.match(r"^\|?\s*:?-+", lines[index + 1].strip()):
            columns = [_clean_cell(cell) for cell in line.strip("|").split("|")]
            index += 2
            rows: list[list[str]] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append([_clean_cell(cell) for cell in lines[index].strip().strip("|").split("|")])
                index += 1
            tables.append({"title": title, "columns": columns, "rows": rows, "objectRefs": [[] for _ in rows]})
            continue
        index += 1
    return tables


def _addressing_table(bundle: dict[str, Any]) -> dict[str, Any]:
    assignments = bundle["addressing"]["assignments"]
    grouped: dict[tuple[str, str, str, str | None], dict[str, Any]] = {}
    for item in assignments:
        key = (item["node"], item["interface"], item["kind"], item.get("segmentId"))
        row = grouped.setdefault(
            key,
            {
                "node": item["node"],
                "interface": item["interface"],
                "kind": item["kind"],
                "pool": item.get("pool") or "manual",
                "ipv4": "",
                "ipv6": "",
                "refs": {f"node:{item['node']}"},
            },
        )
        row[item["family"]] = item["address"]
        row["refs"].update(item["objectRefs"])
    rows = sorted(grouped.values(), key=lambda item: (item["node"], item["kind"], item["interface"]))
    return {
        "title": "Addressing",
        "columns": ["Node", "Interface", "IPv4 Address", "IPv6 Address", "Kind", "Pool"],
        "rows": [[row["node"], row["interface"], row["ipv4"], row["ipv6"], row["kind"], row["pool"]] for row in rows],
        "objectRefs": [sorted(row["refs"]) for row in rows],
    }


def _bgp_table(bundle: dict[str, Any]) -> dict[str, Any]:
    sessions = [item for item in bundle["controlPlane"]["adjacencies"] if item["protocol"] == "bgp"]
    rows = []
    refs = []
    for item in sessions:
        rows.append(
            [
                item.get("source") or "",
                item.get("target") or "",
                item.get("sessionType") or "",
                item.get("sourceAs") or "",
                item.get("targetAs") or "",
                ", ".join(item.get("addressFamilies") or []),
                item.get("targetAddress") or "",
            ]
        )
        refs.append([item["id"], *[f"node:{node}" for node in item["nodeIds"]]])
    return {
        "title": "BGP Neighbors",
        "columns": [
            "Local Node",
            "Neighbor",
            "Session",
            "Local AS",
            "Neighbor AS",
            "Address Families",
            "Neighbor Address",
        ],
        "rows": rows,
        "objectRefs": refs,
    }


def _markdown_table(table: dict[str, Any]) -> str:
    columns = table["columns"]
    lines = [f"## {table['title']}", "", f"| {' | '.join(columns)} |", f"| {' | '.join('---' for _ in columns)} |"]
    lines.extend(f"| {' | '.join(str(cell) for cell in row)} |" for row in table["rows"])
    return "\n".join(lines) + "\n"


def _normalize_ip(cell: str) -> str | None:
    try:
        return ipaddress.ip_interface(cell).ip.compressed
    except ValueError:
        try:
            return ipaddress.ip_address(cell).compressed
        except ValueError:
            return None


def _link_custom_rows(tables: list[dict[str, Any]], bundle: dict[str, Any]) -> None:
    nodes = {item["node"] for item in bundle["controlPlane"]["nodes"]}
    addresses: dict[str, list[str]] = {}
    for item in bundle["addressing"]["assignments"]:
        normalized = _normalize_ip(item["address"])
        if normalized:
            addresses.setdefault(normalized, []).append(item["id"])
    bgp = [item for item in bundle["controlPlane"]["adjacencies"] if item["protocol"] == "bgp"]
    for table in tables:
        refs_by_row: list[list[str]] = []
        for row in table["rows"]:
            refs: set[str] = set()
            row_nodes = {cell for cell in row if cell in nodes}
            refs.update(f"node:{node}" for node in row_nodes)
            for cell in row:
                normalized = _normalize_ip(cell)
                if normalized:
                    refs.update(addresses.get(normalized, []))
            for adjacency in bgp:
                if set(adjacency["nodeIds"]).issubset(row_nodes):
                    refs.add(adjacency["id"])
            refs_by_row.append(sorted(refs))
        table["objectRefs"] = refs_by_row


async def _run_raw(topology_path: str, report_id: str) -> str:
    if not _REPORT_ID.fullmatch(report_id):
        raise ValueError("invalid report id")
    path = Path(topology_path)
    proc = await runner.spawn_command(["report", report_id, "-t", path.name], cwd=path.parent)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=_REPORT_TIMEOUT_SECONDS)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(f"report exceeded {_REPORT_TIMEOUT_SECONDS} second limit") from None
    if proc.returncode:
        raise runner.NetlabError(["netlab", "report", report_id], proc.returncode, stderr.decode(errors="replace"))
    if len(stdout) > _MAX_REPORT_BYTES:
        raise RuntimeError("report output exceeded 2 MiB limit")
    return stdout.decode(errors="replace")


async def run(topology_path: str, revision: int, report_id: str) -> dict[str, Any]:
    descriptors = await catalog(topology_path)
    descriptor = next((item for item in descriptors if item["id"] == report_id), None)
    if descriptor is None:
        raise KeyError(report_id)
    bundle = await bundle_for(topology_path, revision)
    adapter = descriptor.get("structuredAdapter")
    if adapter == "addressing":
        tables = [_addressing_table(bundle)]
        raw = _markdown_table(tables[0])
    elif adapter == "bgp-neighbor":
        tables = [_bgp_table(bundle)]
        raw = _markdown_table(tables[0])
    else:
        raw = await _run_raw(topology_path, report_id)
        tables = parse_markdown_tables(raw)
        _link_custom_rows(tables, bundle)
    return {
        "report": descriptor,
        "tables": tables,
        "raw": raw,
        "searchableText": " ".join(
            [descriptor["name"], descriptor["description"], raw, *[" ".join(table["columns"]) for table in tables]]
        ),
    }
