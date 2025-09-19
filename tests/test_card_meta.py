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


def test_normalize_card_entry_sanitizes_binding_and_lists():
    entry = {
        'workflow_ids': ['wf1', 'WF1', '  '],
        'single_node_binding': {'node_type': '  Loader  ', 'widget': '  node  '},
        'custom_tags': ['Alpha', 'alpha', ''],
        'custom_triggers': ['Beta', None, 'beta'],
        'extra_field': 5,
    }
    normalized = card_meta.normalize_card_entry(entry)
    assert normalized['workflow_ids'] == ['wf1', 'WF1']
    assert normalized['single_node_binding'] == {'node_type': 'Loader', 'widget': 'node'}
    assert normalized['custom_tags'] == ['Alpha']
    assert normalized['custom_triggers'] == ['Beta']
    assert normalized['extra_field'] == 5


def test_update_card_custom_lists_persists(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    meta_path = tmp_path / 'card_meta.json'
    monkeypatch.setattr(card_meta, 'CARD_META_PATH', str(meta_path))
    card_meta.ensure_card_meta_file()

    updated = card_meta.update_card_custom_lists(
        'card123',
        custom_tags=[' Tag ', 'tag', 'Another'],
        custom_triggers=['Trigger', 'TRIGGER', ''],
    )
    assert updated['custom_tags'] == ['Tag', 'Another']
    assert updated['custom_triggers'] == ['Trigger']

    data = card_meta.load_card_meta()
    assert data['cards']['card123']['custom_tags'] == ['Tag', 'Another']
    assert data['cards']['card123']['custom_triggers'] == ['Trigger']

    with open(meta_path, 'r', encoding='utf-8') as handle:
        raw = json.load(handle)
    assert raw['cards']['card123']['custom_tags'] == ['Tag', 'Another']
    assert raw['cards']['card123']['custom_triggers'] == ['Trigger']
