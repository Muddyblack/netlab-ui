"""Custom icon discovery for the standalone netlab GUI."""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import default
from pathlib import Path

_ICON_TYPES = {
    ".svg": ("svg", "image/svg+xml"),
    ".png": ("png", "image/png"),
}
_SAFE_STEM_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(frozen=True)
class UploadedIcon:
    filename: str
    content: bytes


class IconUploadError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class IconDeleteError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def icons_dir() -> Path:
    return Path.home() / ".netlab" / "icons"


def list_custom_icons() -> dict[str, object]:
    directory = icons_dir()
    if not directory.is_dir():
        return {"icons": [], "items": []}

    icons = []
    items = []
    seen_names: set[str] = set()
    for path in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        icon_type = _ICON_TYPES.get(path.suffix.lower())
        if icon_type is None or not path.is_file():
            continue
        name = path.stem
        icon_format, media_type = icon_type
        try:
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        except OSError:
            continue
        if name not in seen_names:
            seen_names.add(name)
            icons.append(name)
        items.append(
            {
                "name": name,
                "source": "global",
                "dataUri": f"data:{media_type};base64,{encoded}",
                "format": icon_format,
            }
        )

    return {"icons": icons, "items": items}


def extract_multipart_icon_upload(content_type: str, body: bytes) -> UploadedIcon:
    """Extract the first ``file`` part from a browser multipart upload."""
    if not content_type.lower().startswith("multipart/form-data"):
        raise IconUploadError("expected multipart/form-data")

    raw_message = b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    try:
        message = BytesParser(policy=default).parsebytes(raw_message)
    except Exception as exc:
        raise IconUploadError("invalid multipart upload") from exc

    if not message.is_multipart():
        raise IconUploadError("invalid multipart upload")

    for part in message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue
        if part.get_param("name", header="content-disposition") != "file":
            continue
        filename = part.get_filename()
        content = part.get_payload(decode=True)
        if not filename or content is None:
            raise IconUploadError("uploaded file is empty")
        return UploadedIcon(filename=filename, content=content)

    raise IconUploadError("missing file field")


def save_uploaded_icon(upload: UploadedIcon) -> str:
    safe_filename = _safe_icon_filename(upload.filename)
    suffix = Path(safe_filename).suffix.lower()
    _validate_icon_content(suffix, upload.content)

    directory = icons_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / safe_filename).write_bytes(upload.content)
    return safe_filename


def delete_custom_icon(name: str) -> list[str]:
    safe_stem = _safe_icon_stem(name)
    directory = icons_dir()
    if not directory.is_dir():
        raise IconDeleteError("icon not found", 404)

    deleted: list[str] = []
    for suffix in _ICON_TYPES:
        path = directory / f"{safe_stem}{suffix}"
        if not path.is_file():
            continue
        path.unlink()
        deleted.append(path.name)

    if not deleted:
        raise IconDeleteError("icon not found", 404)
    return deleted


def _safe_icon_filename(filename: str) -> str:
    name = Path(filename).name.strip()
    if not name:
        raise IconUploadError("missing filename")

    path = Path(name)
    suffix = path.suffix.lower()
    if suffix not in _ICON_TYPES:
        raise IconUploadError("only SVG and PNG icons are supported")

    stem = _SAFE_STEM_PATTERN.sub("_", path.stem).strip("._-")
    if not stem:
        raise IconUploadError("invalid filename")
    return f"{stem}{suffix}"


def _safe_icon_stem(name: str) -> str:
    raw_name = name.strip()
    if not raw_name:
        raise IconDeleteError("missing icon name")

    path = Path(raw_name)
    if path.name != raw_name:
        raise IconDeleteError("invalid icon name")

    if path.suffix.lower() in _ICON_TYPES:
        raw_name = path.stem

    stem = _SAFE_STEM_PATTERN.sub("_", raw_name).strip("._-")
    if not stem or stem != raw_name:
        raise IconDeleteError("invalid icon name")
    return stem


def _validate_icon_content(suffix: str, content: bytes) -> None:
    if not content:
        raise IconUploadError("uploaded file is empty")

    if suffix == ".png":
        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise IconUploadError("invalid PNG icon")
        return

    preview = content[:4096].decode("utf-8-sig", errors="ignore").lower()
    if "<svg" not in preview:
        raise IconUploadError("invalid SVG icon")
