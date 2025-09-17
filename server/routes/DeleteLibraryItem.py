# ================================================
# File: server/routes/DeleteLibraryItem.py
# ================================================
import asyncio
import json
from aiohttp import web

import server  # ComfyUI server instance
from ...downloader.manager import manager as download_manager

prompt_server = server.PromptServer.instance


@prompt_server.routes.post("/civitai/library/delete")
async def route_delete_library_item(request):
    """Delete a downloaded model from disk and update history."""
    if not download_manager:
        return web.json_response({"error": "Download manager not initialized."}, status=500)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    download_id = data.get("download_id") or data.get("id")
    if not download_id:
        return web.json_response({"error": "Missing 'download_id'."}, status=400)

    try:
        result = await asyncio.to_thread(download_manager.delete_downloaded_item, str(download_id))
    except Exception as exc:
        print(f"[Civicomfy] Unexpected error while deleting {download_id}: {exc}")
        return web.json_response(
            {
                "error": "Internal Server Error",
                "details": f"Failed to delete download: {exc}",
            },
            status=500,
        )

    status_code = 200 if result.get("success") else 400
    error_text = (result.get("error") or "").lower()
    if not result.get("success") and "not found" in error_text:
        status_code = 404

    return web.json_response(result, status=status_code)
