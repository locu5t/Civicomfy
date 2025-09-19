"""Utilities for reading and writing Civicomfy card metadata.

Provides helpers to load, sanitize, and update ``card_meta.json``
which stores card-scoped configuration such as workflow attachments
and user-defined tags/triggers.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, Iterable, List

from ..config import PLUGIN_ROOT

CARD_META_PATH = os.path.join(PLUGIN_ROOT, "card_meta.json")
_DEFAULT_META: Dict[str, Any] = {"version": 1, "cards": {}}
_KNOWN_KEYS = {
    "workflow_ids",
    "single_node_binding",
    "custom_tags",
    "custom_triggers",
    "custom_prompt_groups",
}
_LOCK = threading.Lock()

_MAX_CUSTOM_ITEMS = 64
_MAX_CUSTOM_LENGTH = 120
_MAX_PROMPT_GROUPS = 32
_MAX_PROMPT_GROUP_NAME = 120
_MAX_PROMPT_GROUP_ID = 80
_MAX_PROMPT_ITEMS = 256


def _read_file() -> Dict[str, Any]:
    if os.path.exists(CARD_META_PATH):
        try:
            with open(CARD_META_PATH, "r", encoding="utf-8") as handle:
                data = json.load(handle)
                if isinstance(data, dict):
                    return data
        except Exception as exc:  # pragma: no cover - log but continue with defaults
            print(f"[Civicomfy] Warning: failed to read card meta ({CARD_META_PATH}): {exc}")
    return dict(_DEFAULT_META)


def _write_file(payload: Dict[str, Any]) -> None:
    tmp_path = CARD_META_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    os.replace(tmp_path, CARD_META_PATH)


def ensure_card_meta_file() -> None:
    """Ensure the metadata file exists on disk."""
    with _LOCK:
        if not os.path.exists(CARD_META_PATH):
            _write_file(dict(_DEFAULT_META))


def sanitize_custom_list(values: Iterable[Any] | None) -> List[str]:
    """Return a trimmed, de-duplicated list of custom strings."""
    if values is None:
        return []
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, Iterable):
        return []

    cleaned: List[str] = []
    seen: set[str] = set()
    for raw in values:
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        if len(text) > _MAX_CUSTOM_LENGTH:
            text = text[:_MAX_CUSTOM_LENGTH].strip()
        lowered = text.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        cleaned.append(text)
        if len(cleaned) >= _MAX_CUSTOM_ITEMS:
            break
    return cleaned


def sanitize_prompt_items(values: Iterable[Any] | None, *, limit: int | None = None) -> List[str]:
    """Sanitize a sequence of prompt strings while preserving order."""
    if values is None:
        return []
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, Iterable):
        return []

    max_items = limit if isinstance(limit, int) and limit > 0 else _MAX_PROMPT_ITEMS
    cleaned: List[str] = []
    seen: set[str] = set()
    for raw in values:
        if raw is None:
            continue
        text = str(raw).replace("\r", "").strip()
        if not text:
            continue
        if len(text) > _MAX_CUSTOM_LENGTH:
            text = text[:_MAX_CUSTOM_LENGTH].strip()
        lowered = text.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        cleaned.append(text)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _sanitize_prompt_group_id(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) > _MAX_PROMPT_GROUP_ID:
        text = text[:_MAX_PROMPT_GROUP_ID].strip()
    return text or None


def sanitize_prompt_group(group: Any) -> Dict[str, Any] | None:
    """Return a validated prompt group or ``None`` if invalid."""
    if not isinstance(group, dict):
        return None

    group_id = _sanitize_prompt_group_id(group.get("id") or group.get("group_id"))
    if group_id is None:
        return None

    raw_name = group.get("name")
    name = str(raw_name).strip() if isinstance(raw_name, (str, int, float)) else ""
    if not name:
        name = "Untitled group"
    if len(name) > _MAX_PROMPT_GROUP_NAME:
        name = name[:_MAX_PROMPT_GROUP_NAME].strip()
    items = sanitize_prompt_items(group.get("items"))
    if not items:
        return None

    added_at = group.get("added_at")
    added_text = str(added_at).strip() if added_at else None
    updated_at = group.get("updated_at")
    updated_text = str(updated_at).strip() if updated_at else None

    sanitized = {
        "id": group_id,
        "name": name,
        "items": items,
    }
    if added_text:
        sanitized["added_at"] = added_text
    if updated_text:
        sanitized["updated_at"] = updated_text
    return sanitized


def sanitize_prompt_groups(groups: Any) -> List[Dict[str, Any]]:
    """Sanitize a list of prompt group dictionaries."""
    if not isinstance(groups, Iterable):
        return []

    cleaned: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()
    for group in groups:
        sanitized = sanitize_prompt_group(group)
        if sanitized is None:
            continue
        gid = sanitized["id"]
        if gid in seen_ids:
            continue
        seen_ids.add(gid)
        cleaned.append(sanitized)
        if len(cleaned) >= _MAX_PROMPT_GROUPS:
            break
    return cleaned


def _sanitize_workflow_ids(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    result: List[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _sanitize_binding(binding: Any) -> Dict[str, str] | None:
    if not isinstance(binding, dict):
        return None
    node_type = binding.get("node_type")
    if not isinstance(node_type, str) or not node_type.strip():
        return None
    widget = binding.get("widget", "")
    widget_text = str(widget).strip() if widget is not None else ""
    return {"node_type": node_type.strip(), "widget": widget_text}


def normalize_card_entry(entry: Any | None) -> Dict[str, Any]:
    """Return a sanitized card entry with default keys present."""
    source = entry if isinstance(entry, dict) else {}
    normalized: Dict[str, Any] = {
        "workflow_ids": _sanitize_workflow_ids(source.get("workflow_ids")),
        "single_node_binding": _sanitize_binding(source.get("single_node_binding")),
        "custom_tags": sanitize_custom_list(source.get("custom_tags")),
        "custom_triggers": sanitize_custom_list(source.get("custom_triggers")),
        "custom_prompt_groups": sanitize_prompt_groups(source.get("custom_prompt_groups")),
    }
    for key, value in source.items():
        if key not in _KNOWN_KEYS:
            normalized[key] = value
    return normalized


def load_card_meta() -> Dict[str, Any]:
    """Load and sanitize card metadata from disk."""
    ensure_card_meta_file()
    with _LOCK:
        raw = _read_file()
    version = raw.get("version", 1)
    cards = raw.get("cards")
    sanitized_cards: Dict[str, Any] = {}
    if isinstance(cards, dict):
        for card_id, data in cards.items():
            if not isinstance(card_id, str):
                continue
            sanitized_cards[card_id] = normalize_card_entry(data)
    return {"version": version, "cards": sanitized_cards}


def save_card_meta(meta: Dict[str, Any]) -> None:
    """Persist sanitized metadata back to disk."""
    if not isinstance(meta, dict):
        raise ValueError("card meta must be a dict")
    version = meta.get("version", 1)
    cards = meta.get("cards")
    normalized_cards: Dict[str, Any] = {}
    if isinstance(cards, dict):
        for card_id, data in cards.items():
            if not isinstance(card_id, str):
                continue
            normalized_cards[card_id] = normalize_card_entry(data)
    payload = {"version": version, "cards": normalized_cards}
    ensure_card_meta_file()
    with _LOCK:
        _write_file(payload)


def ensure_card_entry(meta: Dict[str, Any], card_id: str) -> Dict[str, Any]:
    """Ensure *card_id* exists in *meta* and return the sanitized entry."""
    if not isinstance(card_id, str) or not card_id:
        raise ValueError("card_id must be a non-empty string")
    cards = meta.setdefault("cards", {})
    if not isinstance(cards, dict):
        cards = {}
        meta["cards"] = cards
    entry = normalize_card_entry(cards.get(card_id))
    cards[card_id] = entry
    return entry


def get_card_entry(card_id: str) -> Dict[str, Any]:
    """Convenience helper to fetch a single card entry."""
    meta = load_card_meta()
    entry = meta["cards"].get(card_id)
    if entry is None:
        entry = normalize_card_entry(None)
    return entry


def update_card_custom_lists(
    card_id: str,
    *,
    custom_tags: Iterable[Any] | None,
    custom_triggers: Iterable[Any] | None,
    custom_prompt_groups: Iterable[Any] | None = None,
) -> Dict[str, Any]:
    """Update user-defined tags/triggers/groups for *card_id* and persist the change."""
    if not isinstance(card_id, str) or not card_id:
        raise ValueError("card_id must be a non-empty string")
    meta = load_card_meta()
    entry = ensure_card_entry(meta, card_id)
    if custom_tags is not None:
        entry["custom_tags"] = sanitize_custom_list(custom_tags)
    if custom_triggers is not None:
        entry["custom_triggers"] = sanitize_custom_list(custom_triggers)
    if custom_prompt_groups is not None:
        entry["custom_prompt_groups"] = sanitize_prompt_groups(custom_prompt_groups)
    meta["cards"][card_id] = entry
    save_card_meta(meta)
    return entry
