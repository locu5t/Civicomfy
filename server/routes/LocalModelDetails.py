# ================================================
# File: server/routes/LocalModelDetails.py
# ================================================
import os
import json
import urllib.parse
from aiohttp import web

import server  # ComfyUI server instance
from ..utils import get_request_json
from ...config import PREVIEW_SUFFIX

prompt_server = server.PromptServer.instance


def _to_media_url(abs_path: str) -> str:
    try:
        q = urllib.parse.quote(abs_path)
        return f"/civitai/local_media?path={q}"
    except Exception:
        return ""


@prompt_server.routes.post("/civitai/local_details")
async def route_local_details(request):
    """Return a details payload built from a local metadata file and cached media.
    Expected input: { metadata_path: string } or { download_id: string }.
    """
    try:
        data = await get_request_json(request)
        meta_path = (data.get('metadata_path') or '').strip()

        if not meta_path:
            return web.json_response({"success": False, "error": "Missing metadata_path"}, status=400)

        if not os.path.exists(meta_path):
            return web.json_response({"success": False, "error": f"Metadata file not found: {meta_path}"}, status=404)

        try:
            with open(meta_path, 'r', encoding='utf-8') as fh:
                meta = json.load(fh)
        except Exception as e:
            return web.json_response({"success": False, "error": f"Failed reading metadata: {e}"}, status=500)

        details = meta.get('OfflineDetails') or meta.get('offline_details')
        # Fallback: build a minimal details payload if offline details missing
        if not isinstance(details, dict):
            details = {
                'success': True,
                'model_id': meta.get('ModelId'),
                'version_id': meta.get('VersionId'),
                'model_name': meta.get('ModelName') or 'Unknown',
                'version_name': meta.get('VersionName') or 'Unknown',
                'creator_username': meta.get('CreatorUsername') or 'Unknown',
                'model_type': meta.get('ModelType') or 'Unknown',
                'civitai_url': None,
                'description_html': meta.get('ModelDescription') or '<p><em>No description provided.</em></p>',
                'version_description_html': meta.get('VersionDescription') or '<p><em>No version description.</em></p>',
                'stats': meta.get('Stats') or {},
                'published_at': meta.get('VersionPublishedAt'),
                'updated_at': meta.get('VersionUpdatedAt'),
                'file_info': meta.get('FileMetadata') or {},
                'files': [],
                'thumbnail_path': None,
                'nsfw_level': None,
                'base_model': meta.get('BaseModel') or '',
                'model_versions': [],
                'tags': meta.get('Tags') or [],
                'trained_words': meta.get('TrainedWords') or [],
                'images': [],
            }

        # Map local filesystem paths to media URLs for the browser
        images = details.get('images') or []
        out_images = []
        for img in images:
            if not isinstance(img, dict):
                continue
            p = img.get('path') or img.get('abs_path')
            if isinstance(p, str) and os.path.isabs(p):
                img = dict(img)
                img['url'] = _to_media_url(p)
            out_images.append(img)

        details['images'] = out_images

        thumb_path = details.get('thumbnail_path')
        if isinstance(thumb_path, str) and os.path.isabs(thumb_path):
            details['thumbnail_url'] = _to_media_url(thumb_path)
        else:
            # Try to derive preview path next to metadata
            try:
                base = os.path.splitext(meta_path)[0]
                candidate = base + PREVIEW_SUFFIX
                if os.path.exists(candidate):
                    details['thumbnail_url'] = _to_media_url(candidate)
            except Exception:
                pass

        # Ensure canonical success flag
        details['success'] = True
        return web.json_response(details)

    except Exception as e:
        return web.json_response({"success": False, "error": f"Internal Server Error: {e}"}, status=500)

