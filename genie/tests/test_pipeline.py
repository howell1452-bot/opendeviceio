"""Pipeline tests using the deterministic MockExtractor (no network, no PDF libs)."""

from __future__ import annotations

import json

import pytest

from odio_genie import (
    GENERATOR,
    ConfidenceSignals,
    MockExtractor,
    assemble,
    build_draft,
    extract,
    score,
    validate,
)
from odio_genie.models import ExtractedText, SourceDocument
from odio_genie.pipeline import render_review_report, write_draft, write_review_report


def _extracted() -> ExtractedText:
    return ExtractedText(
        text="Acme EXT-100 HDMI to HDBaseT extender.",
        source=SourceDocument(title="ext-100.pdf", path="ext-100.pdf", sha256="a" * 64),
    )


def test_mock_candidate_is_schema_valid():
    candidate = MockExtractor().extract("ignored")
    assert validate(candidate) == []


def test_build_draft_validates_and_sets_provenance():
    draft, errors = build_draft(_extracted(), MockExtractor())
    assert errors == [], errors

    prov = draft["provenance"]
    assert prov["generator"] == GENERATOR == "genie/0.1.0"
    assert prov["method"] == "llm-extraction"
    assert prov["validation"]["status"] == "draft"
    assert "confidence" in prov
    assert 0.0 <= prov["confidence"]["overall"] <= 1.0


def test_build_draft_records_source_document():
    draft, _ = build_draft(_extracted(), MockExtractor())
    sources = draft["provenance"]["sourceDocuments"]
    assert sources[0]["title"] == "ext-100.pdf"
    assert sources[0]["sha256"] == "a" * 64
    assert "retrieved" in sources[0]


def test_assembled_draft_still_validates_after_full_round_trip(tmp_path):
    draft, errors = build_draft(_extracted(), MockExtractor())
    assert errors == []
    out = write_draft(draft, tmp_path / "device.odio.json")
    reloaded = json.loads(out.read_text(encoding="utf-8"))
    assert validate(reloaded) == []


def test_extract_rejects_non_dict():
    class BadExtractor(MockExtractor):
        def extract(self, text):  # type: ignore[override]
            return ["not", "a", "dict"]

    with pytest.raises(Exception):
        extract("x", BadExtractor())


def test_assemble_preserves_existing_confidence():
    doc = {"device": {"manufacturer": "A", "model": "B"}}
    score(doc, ConfidenceSignals(field_confidence={"device.model": 0.3}))
    assemble(doc, source=None)
    assert "confidence" in doc["provenance"]
    assert doc["provenance"]["generator"] == GENERATOR


def test_review_report_lists_low_confidence_and_clean_validation():
    draft, errors = build_draft(_extracted(), MockExtractor())
    signals = MockExtractor().signals()
    report = render_review_report(draft, errors, signals)
    assert "Genie review report" in report
    assert "power.consumptionWatts.max" in report
    assert "validates cleanly" in report


def test_write_review_report_for_invalid_draft(tmp_path):
    # An invalid candidate (missing required device.model) still emits a report
    # that surfaces the schema violation.
    bad = {
        "odioVersion": "0.1.0",
        "id": "acme/widget",
        "device": {"manufacturer": "Acme"},
        "ports": [
            {
                "id": "p1",
                "direction": "input",
                "connector": "hdmi-type-a",
                "signals": [{"domain": "video", "transport": "hdmi"}],
            }
        ],
    }
    extractor = MockExtractor(candidate=bad, signals=ConfidenceSignals())
    draft, errors = build_draft(_extracted(), extractor)
    assert errors, "expected schema violations"
    path = write_review_report(draft, errors, tmp_path / "report.md")
    text = path.read_text(encoding="utf-8")
    assert "schema violation" in text
