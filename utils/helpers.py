"""Helper utilities for directory handling, URL parsing, and file selection."""
from __future__ import annotations

import os
import re
from contextlib import suppress
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qs, urlparse

import folder_paths

from ..config import MODEL_TYPE_DIRS

_CIVITAI_HOSTS = {"civitai.com", "www.civitai.com"}
_HUGGINGFACE_HOSTS = {"huggingface.co", "www.huggingface.co"}
_MAX_FILENAME_LEN = 200
_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
}
_INVALID_TRANSLATION = str.maketrans({c: "_" for c in '<>:"/\\|?*' + "".join(map(chr, range(32)))})


def _models_root() -> Path:
    models_dir = getattr(folder_paths, "models_dir", None)
    if models_dir:
        return Path(models_dir)
    base = getattr(folder_paths, "base_path", os.getcwd())
    return Path(base) / "models"


def _resolve_registered_dir(folder_type: str) -> Path:
    with suppress(Exception):
        directory = folder_paths.get_directory_by_type(folder_type)
        if directory:
            return Path(directory)
    with suppress(Exception):
        get_fp = getattr(folder_paths, "get_folder_paths", None)
        if callable(get_fp):
            candidates = get_fp(folder_type)
            if isinstance(candidates, (list, tuple)):
                for candidate in candidates:
                    if candidate:
                        return Path(candidate)
    return _models_root() / folder_type


@lru_cache(maxsize=None)
def get_model_dir(model_type: str) -> str:
    """Resolve and ensure the directory for a given model type exists."""
    raw = (model_type or "").strip()
    key = raw.lower()
    folder_type = MODEL_TYPE_DIRS.get(key, (None, None))[1]

    if folder_type:
        target = _resolve_registered_dir(folder_type)
    else:
        target = _models_root() / (raw or "other")

    target.mkdir(parents=True, exist_ok=True)
    return str(target)


def _first_int(values: Optional[Iterable[Any]]) -> Optional[int]:
    for value in values or ():
        text = str(value).strip()
        if text.isdigit():
            return int(text)
        with suppress(ValueError, TypeError):
            return int(text)
    return None


def _extract_path_id(parts: List[str], token: str) -> Optional[int]:
    with suppress(ValueError, IndexError):
        idx = parts.index(token)
        candidate = parts[idx + 1]
        if candidate.isdigit():
            return int(candidate)
    return None


def parse_civitai_input(url_or_id: str) -> tuple[Optional[int], Optional[int]]:
    """Parse a Civitai URL or ID string into (model_id, version_id)."""
    value = (url_or_id or "").strip()
    if not value:
        return None, None
    if value.isdigit():
        return int(value), None

    candidate = value
    if "//" not in candidate:
        candidate = f"https://civitai.com/{candidate.lstrip('/')}"

    try:
        parsed = urlparse(candidate)
    except Exception:
        return None, None

    host = parsed.netloc.split(":")[0].lower()
    if host and host not in _CIVITAI_HOSTS:
        return None, None

    parts = [p for p in parsed.path.split("/") if p]
    query = parse_qs(parsed.query)

    model_id = _extract_path_id(parts, "models")
    version_id = _first_int(query.get("modelVersionId")) or _extract_path_id(parts, "model-versions")

    return model_id, version_id


def parse_huggingface_input(value: str) -> tuple[Optional[str], Optional[str]]:
    """Parse a Hugging Face repo string or URL into (repo_id, revision)."""

    text = (value or "").strip()
    if not text:
        return None, None

    # Direct repo id like "owner/model"
    if "//" not in text and text.count("/") >= 1:
        cleaned = text.strip("/")
        if cleaned:
            return cleaned, None
        return None, None

    candidate = text
    if "//" not in candidate:
        candidate = f"https://huggingface.co/{candidate.lstrip('/')}"

    try:
        parsed = urlparse(candidate)
    except Exception:
        return None, None

    host = parsed.netloc.split(":")[0].lower()
    if host not in _HUGGINGFACE_HOSTS:
        return None, None

    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        return None, None

    # Handle URLs like /models/owner/model
    if parts[0] in {"models", "model"} and len(parts) >= 3:
        repo_parts = parts[1:3]
        remainder = parts[3:]
    else:
        repo_parts = parts[:2]
        remainder = parts[2:]

    repo_id = "/".join(repo_parts).strip("/")
    revision: Optional[str] = None

    if remainder and remainder[0].lower() == "resolve" and len(remainder) >= 2:
        revision = remainder[1]
    else:
        query = parse_qs(parsed.query)
        revision = (query.get("revision") or query.get("ref") or query.get("commit"))
        if isinstance(revision, list):
            revision = revision[0] if revision else None

    return (repo_id or None), (revision or None)


def sanitize_filename(filename: str, default_filename: str = "downloaded_model") -> str:
    """Return a filesystem-safe filename across platforms."""
    if not filename:
        return default_filename
    if isinstance(filename, bytes):
        filename = filename.decode("utf-8", errors="ignore") or default_filename

    sanitized = filename.translate(_INVALID_TRANSLATION)
    sanitized = re.sub(r"\s+", "_", sanitized)
    sanitized = re.sub(r"_+", "_", sanitized).strip("._ ")

    if not sanitized or sanitized in {".", ".."}:
        sanitized = default_filename

    stem, ext = os.path.splitext(sanitized)
    if stem.upper() in _RESERVED_NAMES:
        sanitized = f"_{stem}{ext}"

    if len(sanitized) > _MAX_FILENAME_LEN:
        allowed = _MAX_FILENAME_LEN - len(ext)
        if allowed <= 0:
            sanitized = sanitized[:_MAX_FILENAME_LEN]
        else:
            sanitized = stem[:allowed] + ext

    return sanitized or default_filename


def select_primary_file(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Select the most appropriate file using a simple heuristic."""
    if not files:
        return None

    valid_files = [f for f in files if isinstance(f, dict) and f.get("downloadUrl")]
    if not valid_files:
        return None

    def priority(file_obj: Dict[str, Any]) -> tuple:
        meta = file_obj.get("metadata") or {}
        name = (file_obj.get("name") or "").lower()
        fmt = (meta.get("format") or "").lower()
        size_tag = (meta.get("size") or "").lower()
        file_type = (file_obj.get("type") or "").lower()

        safetensor = "safetensor" in fmt or name.endswith(".safetensors")
        pickle = any(name.endswith(ext) for ext in (".ckpt", ".pt")) or "pickle" in fmt
        pruned = size_tag == "pruned"

        format_rank = (
            0
            if safetensor and pruned
            else 1
            if safetensor
            else 2
            if pickle and pruned
            else 3
            if pickle
            else 4
            if file_type == "model"
            else 5
            if file_type == "pruned model"
            else 6
        )

        return (
            0 if file_obj.get("primary") else 1,
            format_rank,
            name,
        )

    return min(valid_files, key=priority)
