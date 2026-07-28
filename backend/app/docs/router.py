"""Generic docs endpoint — serves markdown from the ref/ tree or generates
it on-the-fly from netsim data.

GET /api/docs?path=<relative-path>

``path`` is a slash-separated relative path resolved inside the repo's
  platforms   — the original ``docs/platforms.md`` fetched from the netlab repo
                at the installed version's tag (falls back to a locally
                generated device list when offline)
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from app.contract.responses import DocsDocument
from services.netlab import docs as netlab_docs
from services.netlab import location

router = APIRouter(prefix="/api/docs", tags=["docs"])

# Repo-relative docs root (present when the full repo is checked out).
_REPO_DOCS = Path(__file__).resolve().parents[3] / "ref" / "netlab" / "docs"

# Internal device kinds that are parent stubs, not real selectable devices.
_META_DEVICES = {"_common", "unknown", "none", "ios", "junos", "xr"}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _netsim_devices_dir() -> Path | None:
    package_dir = location.netsim_package_dir()
    p = package_dir / "devices" if package_dir else None
    return p if p and p.is_dir() else None


def _generate_platforms_md() -> str:
    devices_dir = _netsim_devices_dir()
    if not devices_dir:
        return (
            "# Supported Platforms\n\n"
            "netlab is not installed — platform list unavailable.\n\n"
            "See [netlab.tools/platforms](https://netlab.tools/platforms/) for the full list.\n"
        )

    try:
        from ruamel.yaml import YAML

        _yaml = YAML()
    except ModuleNotFoundError:
        return "# Supported Platforms\n\nnetsim or ruamel.yaml not available.\n"

    rows: list[tuple[str, str, str, str]] = []
    for yml in sorted(devices_dir.glob("*.yml")):
        kind = yml.stem
        if kind in _META_DEVICES:
            continue
        try:
            data = _yaml.load(yml.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001 — one malformed device file must not break the catalog
            continue
        label = data.get("description") or kind
        clab = data.get("clab") or {}
        image = clab.get("image", "")
        build_url = clab.get("build", "")
        rows.append((kind, label, image, build_url))

    lines = [
        "# Supported Platforms",
        "",
        "Dynamically generated from the installed **netlab** package.",
        "Full documentation: [netlab.tools/platforms](https://netlab.tools/platforms/)",
        "",
        "| Kind | Description | Default cEOS/clab image | Docs |",
        "|------|-------------|-------------------------|------|",
    ]
    for kind, label, image, build_url in rows:
        docs_cell = f"[docs]({build_url})" if build_url else ""
        lines.append(f"| `{kind}` | {label} | `{image}` | {docs_cell} |")

    return "\n".join(lines) + "\n"


def _load_ref_doc(path: str) -> DocsDocument | None:
    """Try to load a markdown file from the repo ref tree."""
    # Normalise: strip leading slash, ensure .md suffix
    clean = path.lstrip("/")
    if not clean.endswith(".md"):
        clean += ".md"

    # Prevent path traversal
    candidate = (_REPO_DOCS / clean).resolve(strict=False)
    if _REPO_DOCS.resolve(strict=False) not in candidate.parents:
        return None
    if not candidate.is_file():
        return None

    content = candidate.read_text(encoding="utf-8")
    title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else clean
    return DocsDocument(title=title, markdown=content.strip())


# --------------------------------------------------------------------------- #
# Endpoint
# --------------------------------------------------------------------------- #


@router.get("", response_model=DocsDocument)
def get_doc(path: str = Query(..., description="Relative doc path, e.g. 'platforms' or 'plugins/bgp'")):
    # Virtual built-in docs
    if path.strip("/") == "platforms":
        # Prefer the original platforms.md shipped with this netlab version;
        # only fall back to a locally generated list when offline.
        md = netlab_docs.fetch_doc("platforms.md") or _generate_platforms_md()
        return DocsDocument(
            title="Supported Platforms",
            markdown=md,
            docs_url="https://netlab.tools/platforms/",
        )

    doc = _load_ref_doc(path)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Doc not found: {path!r}")
    return doc
