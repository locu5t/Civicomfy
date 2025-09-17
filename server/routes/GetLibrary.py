# ================================================
# File: server/routes/GetLibrary.py
# ================================================
import asyncio
from aiohttp import web

import server  # ComfyUI server instance
from ...downloader.manager import manager as download_manager

prompt_server = server.PromptServer.instance


@prompt_server.routes.get("/civitai/library")
async def route_get_library(request):
    """Return the list of downloaded models for the library view."""
    if not download_manager:
        return web.json_response({"error": "Download manager not initialized."}, status=500)

    try:
        items = await asyncio.to_thread(download_manager.get_library_items)
        return web.json_response({"items": items})
    except Exception as exc:
        print(f"[Civicomfy] Error building library payload: {exc}")
        return web.json_response(
            {
                "error": "Internal Server Error",
                "details": f"Failed to read library items: {exc}",
            },
            status=500,
        )
