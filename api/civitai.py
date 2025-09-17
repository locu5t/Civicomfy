"""Utilities for interacting with the Civitai API and Meilisearch."""
from __future__ import annotations

import json
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Union
from urllib.parse import urljoin

import requests

JSONDict = Dict[str, Any]
ResponseType = Union[JSONDict, requests.Response, None]

_MEILI_FACETS = (
    "category.name",
    "checkpointType",
    "fileFormats",
    "lastVersionAtUnix",
    "tags.name",
    "type",
    "user.username",
    "version.baseModel",
    "nsfwLevel",
)

_MEILI_SORT_MAP = {
    "Relevancy": None,
    "Most Downloaded": "metrics.downloadCount:desc",
    "Highest Rated": "metrics.thumbsUpCount:desc",
    "Most Liked": "metrics.favoriteCount:desc",
    "Most Discussed": "metrics.commentCount:desc",
    "Most Collected": "metrics.collectedCount:desc",
    "Most Buzz": "metrics.tippedAmountCount:desc",
    "Newest": "createdAt:desc",
}

_MEILI_TOKEN = (
    "Bearer "
    "8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61"
)


@dataclass
class _MeiliQuery:
    """Represents a single Meilisearch query payload."""

    query: Optional[str] = ""
    types: Optional[Iterable[str]] = None
    base_models: Optional[Iterable[str]] = None
    sort: Optional[str] = None
    limit: int = 20
    page: int = 1
    nsfw: Optional[bool] = None

    def __post_init__(self) -> None:
        self.limit = self._clamp(self.limit, 1, 100)
        self.page = max(1, int(self.page or 1))

    @staticmethod
    def _clamp(value: Any, low: int, high: int) -> int:
        with suppress(TypeError, ValueError):
            return max(low, min(high, int(value)))
        return low

    @staticmethod
    def _clean_iterable(values: Optional[Iterable[str]]) -> tuple[str, ...]:
        if not values:
            return ()
        if isinstance(values, (str, bytes)):
            values = [values]
        cleaned = []
        seen = set()
        for value in values:
            text = str(value).strip()
            if text and text not in seen:
                cleaned.append(text)
                seen.add(text)
        return tuple(cleaned)

    @property
    def offset(self) -> int:
        return max(0, (self.page - 1) * self.limit)

    def payload(self) -> JSONDict:
        filters = []
        type_filters = [f'"type"="{t}"' for t in self._clean_iterable(self.types)]
        base_filters = [
            f'"version.baseModel"="{bm}"' for bm in self._clean_iterable(self.base_models)
        ]
        if type_filters:
            filters.append(type_filters)
        if base_filters:
            filters.append(base_filters)
        if not self.nsfw:
            filters.append("nsfwLevel IN [1, 2, 4]")
        filters.append("availability = Public")

        query: JSONDict = {
            "q": (self.query or ""),
            "indexUid": "models_v9",
            "facets": list(_MEILI_FACETS),
            "attributesToHighlight": [],
            "highlightPreTag": "__ais-highlight__",
            "highlightPostTag": "__/ais-highlight__",
            "limit": self.limit,
            "offset": self.offset,
            "filter": filters,
        }
        if self.sort:
            query["sort"] = [self.sort]
        return {"queries": [query]}


class CivitaiAPI:
    """Lightweight wrapper for the Civitai REST API and Meilisearch."""

    BASE_URL = "https://civitai.com/api/v1"
    MEILI_URL = "https://search.civitai.com/multi-search"

    def __init__(self, api_key: Optional[str] = None, session: Optional[requests.Session] = None):
        self.api_key = api_key
        self.session = session or requests.Session()
        self.base_headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            self.base_headers["Authorization"] = f"Bearer {api_key}"

    # ------------------------------------------------------------------
    # Internal utilities
    # ------------------------------------------------------------------
    def _error(self, message: str, status_code: Optional[int] = None, details: Any = None) -> JSONDict:
        return {"error": message, "status_code": status_code, "details": details}

    @staticmethod
    def _response_details(response: Optional[requests.Response]) -> Any:
        if response is None:
            return None
        with suppress(ValueError, json.JSONDecodeError):
            return response.json()
        text = getattr(response, "text", "") or ""
        return text[:200]

    def _send(
        self,
        method: str,
        url: str,
        *,
        params: Optional[JSONDict] = None,
        json_data: Optional[JSONDict] = None,
        stream: bool = False,
        headers: Optional[Dict[str, str]] = None,
        allow_redirects: bool = True,
        timeout: int = 30,
    ) -> ResponseType:
        request_headers = dict(self.base_headers)
        if headers:
            request_headers.update(headers)
        if method.upper() in {"GET", "HEAD"} and json_data is None:
            request_headers.pop("Content-Type", None)

        response: Optional[requests.Response] = None
        try:
            response = self.session.request(
                method,
                url,
                headers=request_headers,
                params=params,
                json=json_data,
                stream=stream,
                allow_redirects=allow_redirects,
                timeout=timeout,
            )
            response.raise_for_status()
            if stream:
                return response
            if response.status_code == 204 or not response.content:
                return None
            return response.json()
        except requests.exceptions.HTTPError as exc:
            response = exc.response or response
            status = response.status_code if response is not None else None
            return self._error(
                f"HTTP Error: {status}",
                status,
                self._response_details(response),
            )
        except requests.exceptions.RequestException as exc:
            return self._error(str(exc))
        except ValueError:
            status = response.status_code if response is not None else None
            detail = response.text[:200] if response is not None else "N/A"
            return self._error("Invalid JSON response", status, detail)

    def _request(self, method: str, endpoint: str, **kwargs: Any) -> ResponseType:
        url = urljoin(f"{self.BASE_URL}/", endpoint.lstrip("/"))
        return self._send(method, url, **kwargs)

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------
    def get_model_info(self, model_id: int) -> ResponseType:
        return self._request("GET", f"/models/{model_id}")

    def get_model_version_info(self, version_id: int) -> ResponseType:
        return self._request("GET", f"/model-versions/{version_id}")

    def search_models(
        self,
        query: str,
        types: Optional[Iterable[str]] = None,
        sort: str = "Highest Rated",
        period: str = "AllTime",
        limit: int = 20,
        page: int = 1,
        nsfw: Optional[bool] = None,
    ) -> ResponseType:
        limit = _MeiliQuery._clamp(limit, 1, 100)
        page = max(1, int(page or 1))
        params: JSONDict = {
            "limit": limit,
            "page": page,
            "query": query,
            "sort": sort,
            "period": period,
        }
        if types:
            params["types"] = list(types)
        if nsfw is not None:
            params["nsfw"] = str(nsfw).lower()

        result = self._request("GET", "/models", params=params)
        if isinstance(result, dict) and "error" in result:
            return result
        if isinstance(result, dict) and {"items", "metadata"}.issubset(result):
            return result
        return {
            "items": [],
            "metadata": {
                "totalItems": 0,
                "currentPage": page,
                "pageSize": limit,
                "totalPages": 0,
            },
        }

    def search_models_meili(
        self,
        query: str,
        types: Optional[Iterable[str]] = None,
        base_models: Optional[Iterable[str]] = None,
        sort: str = "metrics.downloadCount:desc",
        limit: int = 20,
        page: int = 1,
        nsfw: Optional[bool] = None,
    ) -> ResponseType:
        mapped_sort = _MEILI_SORT_MAP.get(sort, sort)
        query_obj = _MeiliQuery(
            query=query,
            types=types,
            base_models=base_models,
            sort=mapped_sort,
            limit=limit,
            page=page,
            nsfw=nsfw,
        )
        payload = query_obj.payload()
        result = self._send(
            "POST",
            self.MEILI_URL,
            json_data=payload,
            headers={"Authorization": _MEILI_TOKEN},
            timeout=25,
        )
        if isinstance(result, dict) and "error" in result:
            return result
        if not isinstance(result, dict) or "results" not in result:
            return {"hits": [], "limit": query_obj.limit, "offset": query_obj.offset, "estimatedTotalHits": 0}

        first = result.get("results")
        if isinstance(first, list) and first:
            first_entry = first[0]
            if isinstance(first_entry, dict) and "hits" in first_entry:
                return first_entry
        return {"hits": [], "limit": query_obj.limit, "offset": query_obj.offset, "estimatedTotalHits": 0}
