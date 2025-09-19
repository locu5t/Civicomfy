# ================================================
# File: server/routes/ServeLocalMedia.py
# ================================================
import os
import mimetypes
import urllib.parse
from aiohttp import web

import server  # ComfyUI server instance
from ...config import MEDIA_DIR_SUFFIX, PREVIEW_SUFFIX, COMFYUI_ROOT_DIR

prompt_server = server.PromptServer.instance


def _is_allowed_media_path(path: str) -> bool:
    try:
        ap = os.path.abspath(path)
        # Basic sanity: file must exist and be under COMFYUI root if possible
        if not os.path.exists(ap) or not os.path.isfile(ap):
            return False

        # Allow preview files (same dir as model file) and media folder items (*.media/*)
        parent = os.path.basename(os.path.dirname(ap))
        if parent.endswith(MEDIA_DIR_SUFFIX):
            return True
        if ap.endswith(PREVIEW_SUFFIX):
            return True

        # As a safety net, also require it to live under ComfyUI base path
        try:
            base = os.path.abspath(COMFYUI_ROOT_DIR)
            return os.path.commonpath([base, ap]) == base
        except Exception:
            return False
    except Exception:
        return False


@prompt_server.routes.get("/civitai/local_media")
async def route_local_media(request):
    """Serve a cached media file for offline details view."""
    try:
        q = request.query.get('path')
        if not q:
            raise web.HTTPBadRequest(text="Missing 'path' query param")
        path = urllib.parse.unquote(q)
        if not _is_allowed_media_path(path):
            raise web.HTTPForbidden(text="Access denied")
        ctype, _ = mimetypes.guess_type(path)
        headers = {}
        if ctype:
            headers['Content-Type'] = ctype
        headers['Cache-Control'] = 'public, max-age=31536000'
        return web.FileResponse(path, headers=headers)
    except web.HTTPError as he:
        raise he
    except Exception as e:
        return web.Response(status=500, text=f"Error: {e}")

