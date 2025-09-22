# ================================================
# File: server/routes/GetHuggingFaceDetails.py
# ================================================
import json
import os
from typing import Any, Dict, Iterable, List, Optional

from aiohttp import web

import server  # ComfyUI server instance
from ..utils import get_request_json
from ...api.huggingface import HuggingFaceAPI
from ...utils.helpers import parse_huggingface_input

prompt_server = server.PromptServer.instance

_MEDIA_IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".avif",
}
_MEDIA_VIDEO_EXTENSIONS = {
    ".mp4",
    ".webm",
    ".mov",
    ".mkv",
    ".gifv",
}


def _extract_base_model(tags: Optional[Iterable[Any]]) -> str:
    if not tags:
        return ""
    for tag in tags:
        if not isinstance(tag, str):
            continue
        lowered = tag.lower()
        if lowered.startswith("base_model:"):
            _, _, rest = tag.partition(":")
            return rest
        if lowered.startswith("base model:"):
            _, _, rest = tag.partition(":")
            return rest
    return ""


def _pick_thumbnail(model_info: Dict[str, Any]) -> Optional[str]:
    card = model_info.get("cardData") or {}
    for key in ("thumbnail", "coverImage", "cover_image"):
        value = card.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _should_include_file(path: str) -> bool:
    if not path:
        return False
    normalized = path.strip()
    if not normalized:
        return False
    if normalized.startswith("."):
        return False
    if normalized.endswith("/"):
        return False
    return True


def _resolve_file_path(sibling: Dict[str, Any]) -> Optional[str]:
    for key in ("rfilename", "path", "filename"):
        value = sibling.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _file_priority(path: str) -> tuple:
    lowered = path.lower()
    _, ext = os.path.splitext(lowered)
    order = {
        ".safetensors": 0,
        ".ckpt": 1,
        ".pt": 2,
        ".pth": 3,
        ".bin": 4,
        ".onnx": 5,
        ".gguf": 6,
        ".ggml": 7,
        ".pb": 8,
        ".zip": 9,
        ".tar": 10,
        ".tgz": 11,
    }
    return (order.get(ext, 20), lowered)


def _build_file_entry(repo_id: str, revision: str, sibling: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(sibling, dict):
        return None
    file_path = _resolve_file_path(sibling)
    if not isinstance(file_path, str) or not _should_include_file(file_path):
        return None

    size_bytes = sibling.get("size")
    if size_bytes is None and isinstance(sibling.get("lfs"), dict):
        size_bytes = sibling["lfs"].get("size")
    try:
        size_kb = (int(size_bytes) / 1024) if size_bytes is not None else None
    except (ValueError, TypeError):
        size_kb = None

    download_url = HuggingFaceAPI.build_file_url(repo_id, revision, file_path)
    _, ext = os.path.splitext(file_path)

    entry = {
        "id": f"{revision}:{file_path}",
        "name": file_path,
        "downloadUrl": download_url,
        "size_kb": size_kb,
        "metadata": {
            "format": ext.lstrip(".") if ext else "",
            "path": file_path,
        },
        "huggingface": {
            "repo_id": repo_id,
            "revision": revision,
            "path": file_path,
        },
        "downloadable": True,
    }
    return entry


def _collect_media_files(repo_id: str, revision: str, siblings: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    media: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for sibling in siblings or []:
        if not isinstance(sibling, dict):
            continue
        file_path = _resolve_file_path(sibling)
        if not file_path:
            continue

        lowered = file_path.lower()
        _, ext = os.path.splitext(lowered)
        media_type = None
        if ext in _MEDIA_IMAGE_EXTENSIONS:
            media_type = "image"
        elif ext in _MEDIA_VIDEO_EXTENSIONS:
            media_type = "video"
        else:
            continue

        try:
            size_raw = sibling.get("size")
            if size_raw is None and isinstance(sibling.get("lfs"), dict):
                size_raw = sibling["lfs"].get("size")
            size_bytes = int(size_raw) if size_raw is not None else None
        except (TypeError, ValueError):
            size_bytes = None

        key = file_path.lower()
        if key in seen:
            continue
        seen.add(key)

        url = HuggingFaceAPI.build_file_url(repo_id, revision, file_path)
        media.append(
            {
                "name": file_path,
                "path": file_path,
                "type": media_type,
                "url": url,
                "downloadUrl": url,
                "size_bytes": size_bytes,
            }
        )

    return media


@prompt_server.routes.post("/huggingface/details")
async def route_huggingface_details(request):
    """Return metadata and file list for a Hugging Face model."""

    try:
        data = await get_request_json(request)

        raw_identifier = data.get("model_url_or_id") or data.get("repo_id") or ""
        parsed_repo, parsed_revision = parse_huggingface_input(raw_identifier)

        repo_id = (parsed_repo or data.get("repo_id") or "").strip()
        if not repo_id:
            raise web.HTTPBadRequest(reason="A valid Hugging Face repository id is required.")

        requested_revision = data.get("revision") or data.get("version_id") or data.get("branch")
        revision = (requested_revision or parsed_revision or "main").strip() or "main"

        token = (data.get("token") or data.get("hf_token") or data.get("api_key") or "").strip() or None

        api = HuggingFaceAPI(token=token)
        model_info = api.get_model_info(repo_id, card_data=True)

        if isinstance(model_info, dict) and "error" in model_info and "modelId" not in model_info:
            status_code = model_info.get("status_code") or 502
            raise web.HTTPException(
                reason=model_info.get("error", "Hugging Face API error"),
                status=status_code,
                body=json.dumps(model_info),
            )

        if not isinstance(model_info, dict):
            raise web.HTTPException(
                reason="Unexpected response from Hugging Face API.",
                status=502,
                body=json.dumps({"error": "Unexpected response", "details": model_info}),
            )

        base_model = _extract_base_model(model_info.get("tags") or model_info.get("cardData", {}).get("tags"))
        pipeline = model_info.get("pipeline_tag") or model_info.get("cardData", {}).get("pipeline_tag")
        library = model_info.get("library_name") or model_info.get("cardData", {}).get("library_name")

        siblings = model_info.get("siblings") or []
        file_entries: List[Dict[str, Any]] = []
        for sibling in siblings:
            entry = _build_file_entry(repo_id, revision, sibling)
            if entry:
                file_entries.append(entry)

        file_entries.sort(key=lambda f: _file_priority(f.get("name", "")))
        if file_entries:
            file_entries[0]["primary"] = True

        media_files = _collect_media_files(repo_id, revision, siblings)
        thumbnail_url = _pick_thumbnail(model_info)
        if not thumbnail_url and media_files:
            thumbnail_url = next(
                (item.get("url") for item in media_files if item.get("type") == "image" and item.get("url")),
                None,
            )
        if not thumbnail_url and media_files:
            thumbnail_url = next((item.get("url") for item in media_files if item.get("url")), None)

        version_entry = {
            "id": revision,
            "name": revision,
            "type": pipeline or library or "",
            "baseModel": base_model,
            "provider": "huggingface",
            "revision": revision,
        }

        model_name = repo_id.split("/")[-1] if "/" in repo_id else repo_id

        response = {
            "success": True,
            "provider": "huggingface",
            "model_id": repo_id,
            "model_name": model_name,
            "model_type": pipeline or library or "",
            "version_id": revision,
            "version_name": revision,
            "base_model": base_model,
            "downloads": model_info.get("downloads"),
            "likes": model_info.get("likes"),
            "tags": model_info.get("tags") or [],
            "files": file_entries,
            "model_versions": [version_entry],
            "thumbnail_url": thumbnail_url,
            "media_files": media_files,
            "stats": {
                "downloads": model_info.get("downloads"),
                "likes": model_info.get("likes"),
            },
            "huggingface": {
                "repo_id": repo_id,
                "revision": revision,
                "media_files": media_files,
            },
            "raw": model_info,
        }

        return web.json_response(response)

    except web.HTTPError:
        raise
    except Exception as exc:
        print("--- Unhandled Error in /huggingface/details ---")
        import traceback

        traceback.print_exc()
        print("--- End Error ---")
        return web.json_response(
            {
                "error": "Internal Server Error",
                "details": f"Unexpected Hugging Face details error: {exc}",
                "status_code": 500,
            },
            status=500,
        )
