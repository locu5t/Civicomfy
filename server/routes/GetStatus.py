# ================================================
# File: server/routes/GetStatus.py
# ================================================
from aiohttp import web
import server # ComfyUI server instance
from ...utils.downloader_factory import get_active_download_manager, get_downloader_info

prompt_server = server.PromptServer.instance

@prompt_server.routes.get("/civitai/status")
async def route_get_status(request):
    """API Endpoint to get the status of downloads."""
    try:
        download_manager = get_active_download_manager()
        status = download_manager.get_status()
        
        # Add downloader info to status
        downloader_info = get_downloader_info()
        status["downloader_info"] = downloader_info
        
        return web.json_response(status)
    except Exception as e:
        print(f"Error getting download status: {e}")
        # Format error response consistently
        return web.json_response({"error": "Internal Server Error", "details": f"Failed to get status: {str(e)}", "status_code": 500}, status=500)