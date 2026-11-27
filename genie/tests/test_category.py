"""Category normalization: the Python twin of the SDK's normalizeCategory."""

from __future__ import annotations

import json
import re

import pytest

from odio_genie import (
    GenieError,
    MockExtractor,
    assemble,
    build_draft,
    is_controlled_category,
    load_category_vocab,
    normalize_category,
    normalize_document_categories,
)
from odio_genie.category import find_vocab_dir
from odio_genie.models import ExtractedText, SourceDocument

from .conftest import REPO_ROOT

VOCAB_DIR = REPO_ROOT / "vocab"
CATEGORIES = json.loads((VOCAB_DIR / "categories.json").read_text(encoding="utf-8"))
CATEGORY_MAP = json.loads((VOCAB_DIR / "category-map.json").read_text(encoding="utf-8"))
CONTROLLED = {c["path"] for c in CATEGORIES["categories"]}
SCHEMA = json.loads((REPO_ROOT / "schema" / "v0.1" / "device.schema.json").read_text())
CATEGORY_PATTERN = re.compile(SCHEMA["$defs"]["device"]["properties"]["category"]["pattern"])

# Shared with packages/ts-sdk/test/category.test.ts - keep the two tables in step.
NEAR_DUPLICATES = [
    ("av/accessory/mount", "accessory/mount"),
    ("av/accessory/mounting", "accessory/mount"),
    ("av/accessory/mount-kit", "accessory/mount"),
    ("av/accessories/mounting", "accessory/mount"),
    ("av/amplifier/multichannel", "av/amplifier/power"),
    ("av/amplifier/multi-channel", "av/amplifier/power"),
    ("av/control/touch-screen", "control/touch-panel"),
    ("av/control/touchscreen", "control/touch-panel"),
    ("av/control/touchpanel", "control/touch-panel"),
    ("av/speaker/in-ceiling", "av/loudspeaker/ceiling"),
    ("av/loudspeaker/ceiling", "av/loudspeaker/ceiling"),
]

UNSEEN = [
    ("AV/Accessories/Mounts", "accessory/mount"),
    (" av / speakers / in-ceiling ", "av/loudspeaker/ceiling"),
    ("Av/Control/Touch Screens", "control/touch-panel"),
    ("av/amplifiers/multi_channel", "av/amplifier/power"),
    ("av/control/keypads", "control/keypad"),
    ("audio/speaker/in-wall", "av/loudspeaker/in-wall"),
    ("hvac/thermostats", "control/thermostat"),
    ("av/lighting/dimmers", "lighting/dimmer"),
    ("building/sensor/presence-detector", "control/sensor/occupancy"),
    ("it/power/psu", "power/supply"),
    ("av/conferencing/video-bars", "av/conferencing/video-bar"),
    ("av/wall-plates", "accessory/wall-plate"),
    # Unknown but valid: left alone (only the light segment rules apply).
    ("av/widget/frobnicator", "av/widget/frobnicator"),
    ("it/storage/nas", "it/storage/nas"),
    ("av/assembly", "av/assembly"),
    ("av/speaker/horn", "av/loudspeaker/horn"),
    ("constructor", "constructor"),
    ("av/constructor/hasownproperty", "av/constructor/hasownproperty"),
]


def _extracted() -> ExtractedText:
    return ExtractedText(
        text="ignored",
        source=SourceDocument(title="x.pdf", path="x.pdf", sha256="b" * 64),
    )


def test_vocab_is_found_in_the_repo():
    assert find_vocab_dir().resolve() == VOCAB_DIR.resolve()
    vocab = load_category_vocab()
    assert vocab.version == CATEGORIES["version"]
    assert set(vocab.labels) == CONTROLLED


def test_vocab_paths_match_schema_pattern():
    assert 60 <= len(CONTROLLED) <= 120
    for path in CONTROLLED:
        assert CATEGORY_PATTERN.match(path), path


def test_every_mapping_target_is_controlled():
    outside = [m for m in CATEGORY_MAP["mappings"] if m["to"] not in CONTROLLED]
    assert outside == []


def test_map_covers_observed_categories_and_collapses_them():
    froms = [m["from"] for m in CATEGORY_MAP["mappings"]]
    assert len(froms) == len(set(froms)) == CATEGORY_MAP["observed"]["distinctCategories"]
    assert len({m["to"] for m in CATEGORY_MAP["mappings"]}) < 150


@pytest.mark.parametrize("raw,expected", NEAR_DUPLICATES)
def test_near_duplicates_collapse(raw, expected):
    assert normalize_category(raw) == expected


@pytest.mark.parametrize("raw,expected", UNSEEN)
def test_unseen_inputs_canonicalize(raw, expected):
    result = normalize_category(raw)
    assert result == expected
    assert CATEGORY_PATTERN.match(result)


def test_every_map_entry_and_controlled_path():
    for m in CATEGORY_MAP["mappings"]:
        assert normalize_category(m["from"]) == m["to"], m["from"]
    for path in CONTROLLED:
        assert normalize_category(path) == path


def test_idempotent():
    inputs = [m["from"] for m in CATEGORY_MAP["mappings"]] + [raw for raw, _ in UNSEEN]
    for raw in inputs:
        once = normalize_category(raw)
        assert normalize_category(once) == once, raw


def test_none_and_empty():
    assert normalize_category(None) is None
    assert normalize_category("   ") == ""
    assert is_controlled_category("av/amplifier/power")
    assert not is_controlled_category("av/amplifier/multichannel")
    assert not is_controlled_category(None)


def test_document_categories_normalized_recursively():
    doc = {
        "kind": "bundle",
        "bundle": {"category": "av/conferencing/kit"},
        "components": [
            {"type": "device", "device": {"category": "av/control/touch-screen"}},
            {
                "type": "bundle",
                "bundle": {"category": "av/accessories/mounting"},
                "components": [{"type": "device", "device": {"category": "av/speaker/in-ceiling"}}],
            },
            {"type": "accessory", "name": "Screws"},
        ],
    }
    changes = normalize_document_categories(doc)
    assert doc["bundle"]["category"] == "av/conferencing/room-system"
    assert doc["components"][0]["device"]["category"] == "control/touch-panel"
    assert doc["components"][1]["bundle"]["category"] == "accessory/mount"
    assert doc["components"][1]["components"][0]["device"]["category"] == "av/loudspeaker/ceiling"
    assert ("/components/1/components/0/device/category", "av/speaker/in-ceiling",
            "av/loudspeaker/ceiling") in changes
    assert len(changes) == 4
    assert normalize_document_categories(doc) == []  # idempotent


def test_assemble_normalizes_extracted_category():
    candidate = MockExtractor().extract("ignored")
    candidate["device"]["category"] = "AV/Accessories/Mounting"
    assemble(candidate)
    assert candidate["device"]["category"] == "accessory/mount"


def test_build_draft_bundle_category_is_controlled():
    draft, errors = build_draft(_extracted(), MockExtractor(kind="bundle"))
    assert errors == [], errors
    assert draft["bundle"]["category"] == "av/conferencing/room-system"
    assert draft["components"][0]["device"]["category"] == "av/extender/transmitter"


def test_vocab_dir_override(monkeypatch, tmp_path):
    monkeypatch.setenv("ODIO_VOCAB_DIR", str(tmp_path))
    with pytest.raises(GenieError):
        find_vocab_dir()
    monkeypatch.setenv("ODIO_VOCAB_DIR", str(VOCAB_DIR))
    assert find_vocab_dir() == VOCAB_DIR
