import json
import sys
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if 'folder_paths' not in sys.modules:
    sys.modules['folder_paths'] = SimpleNamespace(base_path=str(ROOT))

from Civicomfy.utils import card_meta


def test_sanitize_custom_list_trims_and_dedupes():
    values = [' Foo ', 'foo', 'BAR', 'bar ', '', '   ', None, 123]
    result = card_meta.sanitize_custom_list(values)
    assert result == ['Foo', 'BAR', '123']


def test_sanitize_prompt_items_preserves_order():
    values = [' Foo ', 'bar', 'FOO', None, 'baz', 'baz ', 'multi\r\nline']
    result = card_meta.sanitize_prompt_items(values)
    assert result == ['Foo', 'bar', 'baz', 'multi\nline']


def test_sanitize_prompt_groups_filters_invalid_entries():
    groups = [
        {'id': '  group-1  ', 'name': ' First ', 'items': ['One', 'one', 'two'], 'added_at': '2023-01-01'},
        {'id': 'group-1', 'name': 'Duplicate', 'items': ['three']},
        {'id': None, 'name': 'Missing id', 'items': ['ok']},
        {'id': 'group-2', 'name': '', 'items': []},
        'not-a-dict',
    ]
    sanitized = card_meta.sanitize_prompt_groups(groups)
    assert sanitized == [
        {'id': 'group-1', 'name': 'First', 'items': ['One', 'two'], 'added_at': '2023-01-01'}
    ]


def test_normalize_card_entry_sanitizes_binding_and_lists():
    entry = {
        'workflow_ids': ['wf1', 'WF1', '  '],
        'single_node_binding': {'node_type': '  Loader  ', 'widget': '  node  '},
        'custom_tags': ['Alpha', 'alpha', ''],
        'custom_triggers': ['Beta', None, 'beta'],
        'custom_prompt_groups': [{'id': 'grp', 'name': 'Name', 'items': ['A', 'a']}],
        'extra_field': 5,
    }
    normalized = card_meta.normalize_card_entry(entry)
    assert normalized['workflow_ids'] == ['wf1', 'WF1']
    assert normalized['single_node_binding'] == {'node_type': 'Loader', 'widget': 'node'}
    assert normalized['custom_tags'] == ['Alpha']
    assert normalized['custom_triggers'] == ['Beta']
    assert normalized['custom_prompt_groups'] == [{'id': 'grp', 'name': 'Name', 'items': ['A'] }]
    assert normalized['extra_field'] == 5


def test_update_card_custom_lists_persists(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    meta_path = tmp_path / 'card_meta.json'
    monkeypatch.setattr(card_meta, 'CARD_META_PATH', str(meta_path))
    card_meta.ensure_card_meta_file()

    updated = card_meta.update_card_custom_lists(
        'card123',
        custom_tags=[' Tag ', 'tag', 'Another'],
        custom_triggers=['Trigger', 'TRIGGER', ''],
        custom_prompt_groups=[{'id': 'pg-1', 'name': 'Group', 'items': ['One', 'one', 'Two']}],
    )
    assert updated['custom_tags'] == ['Tag', 'Another']
    assert updated['custom_triggers'] == ['Trigger']
    assert updated['custom_prompt_groups'] == [{'id': 'pg-1', 'name': 'Group', 'items': ['One', 'Two']}]

    data = card_meta.load_card_meta()
    assert data['cards']['card123']['custom_tags'] == ['Tag', 'Another']
    assert data['cards']['card123']['custom_triggers'] == ['Trigger']
    assert data['cards']['card123']['custom_prompt_groups'] == [{'id': 'pg-1', 'name': 'Group', 'items': ['One', 'Two']}]

    with open(meta_path, 'r', encoding='utf-8') as handle:
        raw = json.load(handle)
    assert raw['cards']['card123']['custom_tags'] == ['Tag', 'Another']
    assert raw['cards']['card123']['custom_triggers'] == ['Trigger']
    assert raw['cards']['card123']['custom_prompt_groups'] == [{'id': 'pg-1', 'name': 'Group', 'items': ['One', 'Two']}]
