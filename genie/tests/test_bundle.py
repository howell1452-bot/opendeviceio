"""Bundle/cable-aware validation, extraction, and CLI tests (offline, no LLM/PDF)."""

from __future__ import annotations

import json

import pytest

from odio_genie import (
    GENERATOR,
    MockExtractor,
    build_draft,
    bundle_tool_schema,
    validate,
    validate_kind,
)
from odio_genie.cli import main
from odio_genie.models import ExtractedText, SourceDocument

from .conftest import EXAMPLES_DIR, INVALID_DIR

BUNDLES_DIR = EXAMPLES_DIR / "bundles"


def _bundle_examples() -> list:
    return sorted(BUNDLES_DIR.glob("*.odio.json"))


def _load(path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _extracted() -> ExtractedText:
    return ExtractedText(
        text="Acme KIT-100 conferencing kit.",
        source=SourceDocument(title="kit-100.pdf", path="kit-100.pdf", sha256="b" * 64),
    )


# --- validate() routing -----------------------------------------------------------


@pytest.mark.parametrize("path", _bundle_examples(), ids=lambda p: p.name)
def test_bundle_examples_validate_clean(path):
    doc = _load(path)
    assert validate_kind(doc) == "bundle"
    assert validate(doc) == [], f"{path.name}: {validate(doc)}"


def test_at_least_one_bundle_example_present():
    assert _bundle_examples(), "expected examples/bundles/*.odio.json"


def test_device_example_routes_as_device():
    device_path = EXAMPLES_DIR / "extron-dtp2-t-211.odio.json"
    doc = _load(device_path)
    assert validate_kind(doc) == "device"
    assert validate(doc) == []


def test_invalid_example_still_fails():
    inv = _load(INVALID_DIR / "missing-required-device.odio.json")
    assert validate(inv), "invalid example should still produce errors"


def test_validate_kind_discriminator():
    assert validate_kind({"kind": "bundle"}) == "bundle"
    assert validate_kind({"kind": "cable"}) == "cable"
    assert validate_kind({"device": {}}) == "device"
    assert validate_kind({}) == "device"


# --- MockExtractor bundle through the pipeline -------------------------------------


def test_mock_bundle_candidate_is_schema_valid():
    candidate = MockExtractor(kind="bundle").extract("ignored")
    assert validate(candidate) == []


def test_build_draft_for_bundle_validates_and_stamps_provenance():
    draft, errors = build_draft(_extracted(), MockExtractor(kind="bundle"))
    assert errors == [], errors
    assert draft["kind"] == "bundle"
    assert draft["$schema"] == "https://opendeviceio.org/schema/v0.1/bundle.schema.json"

    prov = draft["provenance"]
    assert prov["generator"] == GENERATOR
    assert prov["method"] == "llm-extraction"
    assert prov["validation"]["status"] == "draft"
    assert "confidence" in prov


def test_bundle_tool_schema_is_self_contained():
    schema = bundle_tool_schema()
    blob = json.dumps(schema)
    # No FULL-URL $ref should survive; all external refs are inlined to #/$defs/...
    assert '"$ref": "https://opendeviceio.org' not in blob.replace(" ", "")
    assert "_device" in schema["$defs"]
    assert "_cable" in schema["$defs"]


# --- CLI exit codes ----------------------------------------------------------------


def test_cli_validate_bundle_example_exit_0():
    path = BUNDLES_DIR / "crestron-uc-cx100-t-wm.odio.json"
    assert main(["validate", str(path)]) == 0


def test_cli_validate_device_example_exit_0():
    path = EXAMPLES_DIR / "extron-dtp2-t-211.odio.json"
    assert main(["validate", str(path)]) == 0


def test_cli_validate_invalid_example_exit_1():
    path = INVALID_DIR / "missing-required-device.odio.json"
    assert main(["validate", str(path)]) == 1


def test_cli_parse_bundle_mock(tmp_path):
    src = tmp_path / "kit.txt"
    src.write_text("Acme KIT-100 kit", encoding="utf-8")
    out = tmp_path / "kit.odio.json"
    rc = main(["parse", str(src), "-o", str(out), "--kind", "bundle", "--mock"])
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert doc["kind"] == "bundle"
    assert validate(doc) == []
