# ================================================
# File: server/routes/GetHuggingFaceDetails.py
# ================================================
import json
import os
from typing import Any, Dict, Iterable, Optional

from aiohttp import web

import server  # ComfyUI server instance
from ..utils import get_request_json
from ...api.huggingface import HuggingFaceAPI
from ...utils.helpers import parse_huggingface_input

prompt_server = server.PromptServer.instance

_SKIP_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".mp4", ".webm"}
_SKIP_FILENAMES = {"readme.md", "license", "license.md", "license.txt", "readme"}


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
    if path.startswith("."):
        return False
    lowered = path.lower()
    if lowered in _SKIP_FILENAMES:
        return False
    _, ext = os.path.splitext(lowered)
    if ext in _SKIP_EXTENSIONS:
        return False
    return True


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
    file_path = sibling.get("rfilename")
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
        file_entries = []
        for sibling in siblings:
            entry = _build_file_entry(repo_id, revision, sibling)
            if entry:
                file_entries.append(entry)

        file_entries.sort(key=lambda f: _file_priority(f.get("name", "")))
        if file_entries:
            file_entries[0]["primary"] = True

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
            "thumbnail_url": _pick_thumbnail(model_info),
            "stats": {
                "downloads": model_info.get("downloads"),
                "likes": model_info.get("likes"),
            },
            "huggingface": {
                "repo_id": repo_id,
                "revision": revision,
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
