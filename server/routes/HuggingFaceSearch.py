# ================================================
# File: server/routes/HuggingFaceSearch.py
# ================================================
import json
from typing import Any, Iterable, Optional

from aiohttp import web

import server  # ComfyUI server instance
from ..utils import get_request_json
from ...api.huggingface import HuggingFaceAPI

prompt_server = server.PromptServer.instance


def _extract_base_model(tags: Optional[Iterable[Any]]) -> str:
    if not tags:
        return ""
    for tag in tags:
        if not isinstance(tag, str):
            continue
        if tag.lower().startswith("base_model:"):
            parts = tag.split(":", maxsplit=1)
            if len(parts) == 2:
                return parts[1]
        if tag.lower().startswith("base model:"):
            parts = tag.split(":", maxsplit=1)
            if len(parts) == 2:
                return parts[1]
    return ""


@prompt_server.routes.post("/huggingface/search")
async def route_huggingface_search(request):
    """Search Hugging Face models and return card-friendly hits."""

    try:
        data = await get_request_json(request)

        query = (data.get("query") or "").strip()
        if not query:
            raise web.HTTPBadRequest(reason="Search query is required for Hugging Face.")

        limit = int(data.get("limit", 20) or 20)
        page = int(data.get("page", 1) or 1)
        sort = data.get("sort")
        pipeline_tag = (data.get("pipeline_tag") or data.get("task"))
        token = (data.get("token") or data.get("hf_token") or data.get("api_key") or "").strip() or None

        api = HuggingFaceAPI(token=token)
        result = api.search_models(query=query, limit=limit, page=page, sort=sort, pipeline_tag=pipeline_tag)

        if isinstance(result, dict) and "error" in result and "items" not in result:
            status_code = result.get("status_code") or 502
            raise web.HTTPException(
                reason=result.get("error", "Hugging Face API error"),
                status=status_code,
                body=json.dumps(result),
            )

        raw_items = result.get("items", []) if isinstance(result, dict) else []
        items = []

        for raw in raw_items:
            if not isinstance(raw, dict):
                continue

            repo_id = raw.get("modelId") or raw.get("id")
            if not repo_id:
                continue

            author = ""
            name = repo_id
            if "/" in repo_id:
                parts = repo_id.split("/", maxsplit=1)
                author = parts[0]
                name = parts[1] if len(parts) > 1 else repo_id

            revision = "main"
            pipeline = raw.get("pipeline_tag") or raw.get("pipelineTag")
            library = raw.get("library_name") or raw.get("libraryName")
            base_model = _extract_base_model(raw.get("tags"))

            metrics = {
                "downloadCount": raw.get("downloads"),
                "thumbsUpCount": raw.get("likes"),
            }

            version_entry = {
                "id": revision,
                "name": "main",
                "type": pipeline or library or "",
                "baseModel": base_model,
                "provider": "huggingface",
                "revision": revision,
            }

            item = {
                "id": repo_id,
                "modelId": repo_id,
                "name": name or repo_id,
                "type": pipeline or library or "",
                "provider": "huggingface",
                "versions": [version_entry],
                "version": version_entry,
                "metrics": metrics,
                "downloads": raw.get("downloads"),
                "likes": raw.get("likes"),
                "tags": raw.get("tags") or [],
                "baseModel": base_model,
                "thumbnailUrl": None,
                "raw": raw,
            }
            if author:
                item["user"] = {"username": author}
            items.append(item)

        limit = max(1, limit)
        has_more = len(items) >= limit
        total_pages = page + (1 if has_more else 0)
        total_items = page * limit if has_more else (page - 1) * limit + len(items)
        metadata = {
            "currentPage": page,
            "pageSize": limit,
            "totalPages": max(1, total_pages),
            "totalItems": max(len(items), total_items),
            "hasMore": has_more,
        }

        return web.json_response({"items": items, "metadata": metadata})

    except web.HTTPError:
        raise
    except Exception as exc:
        print("--- Unhandled Error in /huggingface/search ---")
        import traceback

        traceback.print_exc()
        print("--- End Error ---")
        return web.json_response(
            {
                "error": "Internal Server Error",
                "details": f"Unexpected Hugging Face search error: {exc}",
                "status_code": 500,
            },
            status=500,
        )
