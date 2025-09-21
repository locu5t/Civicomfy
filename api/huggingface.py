from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote, urljoin

import requests

JSONDict = Dict[str, Any]


class HuggingFaceAPI:
    """Lightweight wrapper around the public Hugging Face Hub REST API."""

    BASE_URL = "https://huggingface.co"

    def __init__(self, token: Optional[str] = None, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()
        self.token = token.strip() if isinstance(token, str) and token.strip() else None
        self.base_headers: Dict[str, str] = {"Accept": "application/json"}
        if self.token:
            auth_value = self.token
            if not auth_value.lower().startswith("bearer "):
                auth_value = f"Bearer {auth_value}"
            self.base_headers["Authorization"] = auth_value

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _error(self, message: str, status_code: Optional[int] = None, details: Any = None) -> JSONDict:
        return {"error": message, "status_code": status_code, "details": details}

    def _send(
        self,
        method: str,
        endpoint: str,
        *,
        params: Optional[JSONDict] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: int = 30,
    ) -> JSONDict | list[Any] | None:
        url = urljoin(f"{self.BASE_URL}/", endpoint.lstrip("/"))
        request_headers = dict(self.base_headers)
        if headers:
            request_headers.update(headers)

        response: Optional[requests.Response] = None
        try:
            response = self.session.request(
                method,
                url,
                headers=request_headers,
                params=params,
                timeout=timeout,
            )
            response.raise_for_status()
            if response.status_code == 204 or not response.content:
                return None
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type:
                return response.json()
            try:
                return json.loads(response.text or "{}")
            except json.JSONDecodeError:
                return response.text
        except requests.exceptions.HTTPError as exc:
            response = exc.response or response
            status = response.status_code if response is not None else None
            detail: Any = None
            if response is not None:
                try:
                    detail = response.json()
                except Exception:
                    detail = (response.text or "")[:200]
            return self._error(f"HTTP Error: {status}", status, detail)
        except requests.exceptions.RequestException as exc:
            return self._error(str(exc))
        except ValueError as exc:
            status = response.status_code if response is not None else None
            detail = (response.text or "")[:200] if response is not None else str(exc)
            return self._error("Invalid JSON response", status, detail)

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------
    @staticmethod
    def _map_sort(sort_label: Optional[str]) -> Tuple[str, int]:
        """Map UI sort labels to Hugging Face sort parameters."""

        mapping = {
            "Most Downloaded": ("downloads", -1),
            "Most Liked": ("likes", -1),
            "Highest Rated": ("likes", -1),
            "Newest": ("lastModified", -1),
        }
        if not sort_label:
            return "downloads", -1
        return mapping.get(sort_label, ("downloads", -1))

    def search_models(
        self,
        *,
        query: Optional[str] = None,
        limit: int = 20,
        page: int = 1,
        sort: Optional[str] = None,
        pipeline_tag: Optional[str] = None,
    ) -> JSONDict:
        limit = max(1, min(int(limit or 1), 50))
        page = max(1, int(page or 1))
        skip = (page - 1) * limit
        sort_key, direction = self._map_sort(sort)

        params: Dict[str, Any] = {
            "limit": limit,
            "skip": skip,
            "search": (query or ""),
            "sort": sort_key,
            "direction": direction,
        }
        if pipeline_tag:
            params["pipeline_tag"] = pipeline_tag

        result = self._send("GET", "/api/models", params=params)
        if isinstance(result, dict) and "error" in result:
            return result
        if not isinstance(result, list):
            return self._error("Unexpected response", details=result)

        return {
            "items": result,
            "params": params,
        }

    def get_model_info(
        self,
        repo_id: str,
        *,
        card_data: bool = True,
        config: bool = False,
    ) -> JSONDict | list[Any] | None:
        safe_repo = quote(repo_id, safe="/:")
        params: Dict[str, Any] = {}
        if card_data:
            params["cardData"] = "true"
        if config:
            params["config"] = "true"
        return self._send("GET", f"/api/models/{safe_repo}", params=params)

    @staticmethod
    def build_file_url(repo_id: str, revision: str, file_path: str) -> str:
        safe_repo = quote(repo_id, safe="/:")
        safe_path = quote(file_path, safe="/:")
        safe_revision = quote(revision or "main", safe="/:")
        return f"https://huggingface.co/{safe_repo}/resolve/{safe_revision}/{safe_path}"
