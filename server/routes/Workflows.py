"""
Lightweight workflow storage and card attachment routes for Civicomfy.

Stores workflows and per-card metadata in extension-local JSON files.

Schema:
  - workflows.json
    {
      "version": 1,
      "workflows": [
        {
          "workflow_id": "wf_xxx",
          "name": "My Flow",
          "node_list": [ { "id": "n1", "type": "NodeType", "widgets": {"foo": 1}, "title": "", "pos": [0,0] } ],
          "connections": [ {"from": "n1", "out_index": 0, "out_name": "", "to": "n2", "in_index": 0, "in_name": ""} ],
          "metadata": { "created_at": "ISO", "updated_at": "ISO", "external_links": [] }
        }
      ]
    }

  - card_meta.json
    {
      "version": 1,
      "cards": {
        "<download_id>": {
          "workflow_ids": ["wf_xxx"],
          "single_node_binding": { "node_type": "CheckpointLoaderSimple", "widget": "ckpt_name" }
        }
      }
    }
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Optional

from aiohttp import web

import server  # ComfyUI server instance
from ...config import PLUGIN_ROOT
from ...utils.card_meta import (
    ensure_card_entry as ensure_card_meta_entry,
    ensure_card_meta_file,
    load_card_meta,
    save_card_meta,
    sanitize_custom_list,
)

prompt_server = server.PromptServer.instance

WORKFLOWS_PATH = os.path.join(PLUGIN_ROOT, "workflows.json")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _load_json(path: str, default: Dict[str, Any]) -> Dict[str, Any]:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
    except Exception as e:
        print(f"[Civicomfy] Warning: Failed to read {path}: {e}")
    return dict(default)


def _save_json(path: str, data: Dict[str, Any]) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as e:
        print(f"[Civicomfy] Error: Failed to save {path}: {e}")


def _ensure_files():
    if not os.path.exists(WORKFLOWS_PATH):
        _save_json(WORKFLOWS_PATH, {"version": 1, "workflows": []})
    ensure_card_meta_file()


def _list_workflows() -> List[Dict[str, Any]]:
    data = _load_json(WORKFLOWS_PATH, {"version": 1, "workflows": []})
    wfs = data.get("workflows")
    return [wf for wf in wfs if isinstance(wf, dict)] if isinstance(wfs, list) else []


def _write_workflows(workflows: List[Dict[str, Any]]) -> None:
    _save_json(WORKFLOWS_PATH, {"version": 1, "workflows": workflows})


def _cards_meta() -> Dict[str, Any]:
    return load_card_meta()


def _write_cards_meta(cards_meta: Dict[str, Any]) -> None:
    save_card_meta(cards_meta)


def _gen_wf_id(existing: List[Dict[str, Any]]) -> str:
    base = int(time.time() * 1000)
    i = 0
    existing_ids = {w.get("workflow_id") for w in existing}
    while True:
        cand = f"wf_{base}_{i}"
        if cand not in existing_ids:
            return cand
        i += 1


@prompt_server.routes.get("/civitai/workflows")
async def route_list_workflows(request):
    """List all workflows. Optional filter by card_id via query."""
    _ensure_files()
    workflows = _list_workflows()
    card_id = request.query.get("card_id")
    if card_id:
        meta = _cards_meta()
        card = meta["cards"].get(card_id, {})
        wf_ids = set(card.get("workflow_ids", []))
        workflows = [w for w in workflows if w.get("workflow_id") in wf_ids]
    # Return compact summary by default
    items = [
        {
            "workflow_id": w.get("workflow_id"),
            "name": w.get("name"),
            "node_count": len(w.get("node_list") or []),
            "connection_count": len(w.get("connections") or []),
            "metadata": w.get("metadata") or {},
        }
        for w in workflows
    ]
    return web.json_response({"workflows": items})


@prompt_server.routes.get("/civitai/workflows/{workflow_id}")
async def route_get_workflow(request):
    _ensure_files()
    workflow_id = request.match_info.get("workflow_id")
    workflows = _list_workflows()
    wf = next((w for w in workflows if w.get("workflow_id") == workflow_id), None)
    if not wf:
        return web.json_response({"error": "Workflow not found"}, status=404)
    return web.json_response({"workflow": wf})


@prompt_server.routes.post("/civitai/workflows")
async def route_save_workflow(request):
    """Create or update a workflow.
    Body: { workflow_id?, name, node_list, connections, metadata? }
    """
    _ensure_files()
    try:
        payload = await request.json()
    except Exception as e:
        return web.json_response({"error": f"Invalid JSON: {e}"}, status=400)

    name = (payload or {}).get("name")
    node_list = (payload or {}).get("node_list")
    connections = (payload or {}).get("connections")
    metadata = (payload or {}).get("metadata") or {}
    if not isinstance(name, str) or not name.strip():
        return web.json_response({"error": "Missing workflow name"}, status=400)
    if not isinstance(node_list, list):
        return web.json_response({"error": "node_list must be an array"}, status=400)
    if not isinstance(connections, list):
        return web.json_response({"error": "connections must be an array"}, status=400)

    workflows = _list_workflows()
    workflow_id = (payload or {}).get("workflow_id")
    is_update = False
    if workflow_id:
        for i, w in enumerate(workflows):
            if w.get("workflow_id") == workflow_id:
                workflows[i] = {
                    "workflow_id": workflow_id,
                    "name": name,
                    "node_list": node_list,
                    "connections": connections,
                    "metadata": {**(w.get("metadata") or {}), **metadata, "updated_at": _now_iso()},
                }
                is_update = True
                break
    if not is_update:
        workflow_id = _gen_wf_id(workflows)
        workflows.append({
            "workflow_id": workflow_id,
            "name": name,
            "node_list": node_list,
            "connections": connections,
            "metadata": {**metadata, "created_at": _now_iso(), "updated_at": _now_iso()},
        })
    _write_workflows(workflows)
    return web.json_response({"success": True, "workflow_id": workflow_id})


@prompt_server.routes.delete("/civitai/workflows/{workflow_id}")
async def route_delete_workflow(request):
    _ensure_files()
    workflow_id = request.match_info.get("workflow_id")
    workflows = _list_workflows()
    new_list = [w for w in workflows if w.get("workflow_id") != workflow_id]
    if len(new_list) == len(workflows):
        return web.json_response({"error": "Workflow not found"}, status=404)
    _write_workflows(new_list)
    # Also detach from any cards
    meta = _cards_meta()
    changed = False
    for card_id in list(meta.get("cards", {}).keys()):
        info = ensure_card_meta_entry(meta, card_id)
        existing = info.get("workflow_ids") or []
        wids = [wid for wid in existing if wid != workflow_id]
        if len(wids) != len(existing):
            info["workflow_ids"] = wids
            meta["cards"][card_id] = info
            changed = True
    if changed:
        _write_cards_meta(meta)
    return web.json_response({"success": True})


@prompt_server.routes.post("/civitai/cards/{card_id}/attach_workflow")
async def route_attach_workflow(request):
    _ensure_files()
    card_id = request.match_info.get("card_id")
    try:
        body = await request.json()
    except Exception:
        body = {}
    workflow_id = (body or {}).get("workflow_id")
    if not workflow_id:
        return web.json_response({"error": "Missing workflow_id"}, status=400)
    workflows = _list_workflows()
    if not any(w.get("workflow_id") == workflow_id for w in workflows):
        return web.json_response({"error": "Workflow not found"}, status=404)
    meta = _cards_meta()
    info = ensure_card_meta_entry(meta, card_id)
    wids = info.get("workflow_ids") or []
    if workflow_id not in wids:
        wids.append(workflow_id)
    info["workflow_ids"] = wids
    meta["cards"][card_id] = info
    _write_cards_meta(meta)
    return web.json_response({"success": True, "card": {"card_id": card_id, **info}})


@prompt_server.routes.post("/civitai/cards/{card_id}/detach_workflow")
async def route_detach_workflow(request):
    _ensure_files()
    card_id = request.match_info.get("card_id")
    try:
        body = await request.json()
    except Exception:
        body = {}
    workflow_id = (body or {}).get("workflow_id")
    if not workflow_id:
        return web.json_response({"error": "Missing workflow_id"}, status=400)
    meta = _cards_meta()
    info = ensure_card_meta_entry(meta, card_id)
    before = list(info.get("workflow_ids", []))
    info["workflow_ids"] = [wid for wid in before if wid != workflow_id]
    meta["cards"][card_id] = info
    _write_cards_meta(meta)
    return web.json_response({"success": True, "card": {"card_id": card_id, **info}})


@prompt_server.routes.get("/civitai/cards/{card_id}/workflows")
async def route_card_workflows(request):
    _ensure_files()
    card_id = request.match_info.get("card_id")
    meta = _cards_meta()
    info = ensure_card_meta_entry(meta, card_id)
    wf_map = {w.get("workflow_id"): w for w in _list_workflows()}
    attached = [wf_map[wid] for wid in info.get("workflow_ids", []) if wid in wf_map]
    # Summary form
    items = [
        {
            "workflow_id": w.get("workflow_id"),
            "name": w.get("name"),
            "node_count": len(w.get("node_list") or []),
            "connection_count": len(w.get("connections") or []),
            "metadata": w.get("metadata") or {},
        }
        for w in attached
    ]
    result = {
        "card_id": card_id,
        "workflow_ids": info.get("workflow_ids", []),
        "single_node_binding": info.get("single_node_binding") or None,
        "custom_tags": info.get("custom_tags", []),
        "custom_triggers": info.get("custom_triggers", []),
        "workflows": items,
    }
    return web.json_response(result)


@prompt_server.routes.post("/civitai/cards/{card_id}/set_binding")
async def route_set_binding(request):
    _ensure_files()
    card_id = request.match_info.get("card_id")
    try:
        body = await request.json()
    except Exception as e:
        return web.json_response({"error": f"Invalid JSON: {e}"}, status=400)
    node_type = (body or {}).get("node_type")
    widget = (body or {}).get("widget") or ""
    if not node_type or not isinstance(node_type, str):
        return web.json_response({"error": "Missing node_type"}, status=400)
    meta = _cards_meta()
    info = ensure_card_meta_entry(meta, card_id)
    info["single_node_binding"] = {"node_type": node_type, "widget": widget}
    meta["cards"][card_id] = info
    _write_cards_meta(meta)
    return web.json_response({"success": True, "card": {"card_id": card_id, **info}})


@prompt_server.routes.get("/civitai/cards/{card_id}/meta")
async def route_get_card_meta(request):
    """Return stored metadata (workflows, bindings, custom tags/triggers) for a card."""
    _ensure_files()
    card_id = request.match_info.get("card_id")
    meta = _cards_meta()
    info = ensure_card_meta_entry(meta, card_id)
    return web.json_response({"card_id": card_id, **info})


@prompt_server.routes.post("/civitai/cards/{card_id}/meta")
async def route_update_card_meta(request):
    """Update user-defined tags and triggers for a card."""
    _ensure_files()
    card_id = request.match_info.get("card_id")
    try:
        body = await request.json()
    except Exception as exc:
        return web.json_response({"error": f"Invalid JSON: {exc}"}, status=400)

    tags_raw = (body or {}).get("custom_tags", [])
    triggers_raw = (body or {}).get("custom_triggers", [])
    if not isinstance(tags_raw, list) or not isinstance(triggers_raw, list):
        return web.json_response({"error": "custom_tags and custom_triggers must be arrays"}, status=400)

    new_tags = sanitize_custom_list(tags_raw)
    new_triggers = sanitize_custom_list(triggers_raw)

    meta = _cards_meta()
    info = ensure_card_meta_entry(meta, card_id)
    changed = (
        new_tags != info.get("custom_tags", [])
        or new_triggers != info.get("custom_triggers", [])
    )
    info["custom_tags"] = new_tags
    info["custom_triggers"] = new_triggers
    meta["cards"][card_id] = info
    _write_cards_meta(meta)
    return web.json_response({
        "success": True,
        "card": {"card_id": card_id, **info},
        "changed": changed,
    })


@prompt_server.routes.get("/civitai/workflows/export")
async def route_export_workflows(request):
    _ensure_files()
    data = _load_json(WORKFLOWS_PATH, {"version": 1, "workflows": []})
    return web.json_response(data)


@prompt_server.routes.post("/civitai/workflows/import")
async def route_import_workflows(request):
    _ensure_files()
    try:
        payload = await request.json()
    except Exception as e:
        return web.json_response({"error": f"Invalid JSON: {e}"}, status=400)
    incoming = payload.get("workflows")
    if not isinstance(incoming, list):
        return web.json_response({"error": "workflows must be an array"}, status=400)
    existing = _list_workflows()
    by_id = {w.get("workflow_id"): w for w in existing}
    for wf in incoming:
        if not isinstance(wf, dict):
            continue
        wid = wf.get("workflow_id")
        if not wid:
            # assign new id
            wid = _gen_wf_id(existing)
            wf["workflow_id"] = wid
        by_id[wid] = wf
    merged = list(by_id.values())
    _write_workflows(merged)
    return web.json_response({"success": True, "count": len(merged)})


print("[Civicomfy] Workflow routes registered.")

