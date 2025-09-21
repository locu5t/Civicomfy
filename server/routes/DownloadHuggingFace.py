# ================================================
# File: server/routes/DownloadHuggingFace.py
# ================================================
import json
import os
from typing import Optional

from aiohttp import web

import server  # ComfyUI server instance
from ..utils import get_request_json
from ...api.huggingface import HuggingFaceAPI
from ...downloader.manager import manager as download_manager
from ...utils.helpers import get_model_dir, parse_huggingface_input, sanitize_filename

prompt_server = server.PromptServer.instance


def _coerce_int(value: Optional[object]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@prompt_server.routes.post("/huggingface/download")
async def route_huggingface_download(request):
    """Queue a Hugging Face model file for download."""

    try:
        data = await get_request_json(request)

        raw_identifier = data.get("model_url_or_id") or data.get("repo_id") or ""
        parsed_repo, parsed_revision = parse_huggingface_input(raw_identifier)

        repo_id = (parsed_repo or data.get("repo_id") or "").strip()
        if not repo_id:
            raise web.HTTPBadRequest(reason="Missing Hugging Face repository id.")

        requested_revision = data.get("revision") or data.get("version_id") or data.get("branch")
        revision = (requested_revision or parsed_revision or "main").strip() or "main"

        file_path = (data.get("file_path") or data.get("file") or data.get("relative_path") or "").strip()
        if not file_path:
            raise web.HTTPBadRequest(reason="File path is required for Hugging Face downloads.")

        file_path = file_path.lstrip("/\\")
        original_name = os.path.basename(file_path) or "download.bin"

        custom_filename = (data.get("custom_filename") or "").strip()
        safe_filename = sanitize_filename(custom_filename or original_name, default_filename=original_name)

        model_type = (data.get("model_type") or "checkpoint").strip() or "checkpoint"
        subdir = (data.get("subdir") or "").strip().strip("/\\")

        base_dir = get_model_dir(model_type)
        target_dir = os.path.join(base_dir, subdir) if subdir else base_dir
        allowed_root = os.path.abspath(base_dir)
        target_dir_abs = os.path.abspath(target_dir)
        if not target_dir_abs.startswith(allowed_root):
            raise web.HTTPBadRequest(reason="Computed directory is outside the allowed model path.")
        os.makedirs(target_dir_abs, exist_ok=True)

        output_path = os.path.abspath(os.path.join(target_dir_abs, safe_filename))
        if not output_path.startswith(allowed_root):
            raise web.HTTPBadRequest(reason="Computed output path is outside the allowed model directory.")

        force_redownload = bool(data.get("force_redownload"))
        if os.path.exists(output_path) and not force_redownload:
            return web.json_response(
                {
                    "status": "exists",
                    "message": "File already exists. Enable force redownload to overwrite.",
                    "download_id": None,
                }
            )

        download_url = HuggingFaceAPI.build_file_url(repo_id, revision, file_path)

        known_size = _coerce_int(data.get("known_size") or data.get("size_bytes"))
        if known_size is None and data.get("size_kb"):
            try:
                known_size = int(float(data.get("size_kb")) * 1024)
            except (TypeError, ValueError):
                known_size = None

        num_connections = max(1, _coerce_int(data.get("num_connections")) or 1)
        token = (data.get("token") or data.get("hf_token") or data.get("api_key") or "").strip() or None

        download_info = {
            "provider": "huggingface",
            "url": download_url,
            "output_path": output_path,
            "filename": safe_filename,
            "known_size": known_size,
            "num_connections": num_connections,
            "force_redownload": force_redownload,
            "api_key": token,
            "model_type": model_type,
            "subdir": subdir,
            "custom_filename": custom_filename or None,
            "model_url_or_id": repo_id,
            "model_version_id": revision,
            "thumbnail": data.get("thumbnail"),
            "model_name": data.get("model_name") or os.path.basename(repo_id),
            "version_name": data.get("version_name") or revision,
            "huggingface_repo_id": repo_id,
            "huggingface_revision": revision,
            "huggingface_path": file_path,
            "civitai_model_info": {},
            "civitai_version_info": {},
            "civitai_primary_file": {},
        }

        download_id = download_manager.add_to_queue(download_info)
        return web.json_response(
            {
                "status": "queued",
                "download_id": download_id,
                "message": "Download queued successfully.",
            }
        )

    except web.HTTPError:
        raise
    except Exception as exc:
        print("--- Unhandled Error in /huggingface/download ---")
        import traceback

        traceback.print_exc()
        print("--- End Error ---")
        return web.json_response(
            {
                "error": "Internal Server Error",
                "details": f"Unexpected Hugging Face download error: {exc}",
                "status_code": 500,
            },
            status=500,
        )
