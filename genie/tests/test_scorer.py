"""Tests for the confidence scorer."""

from __future__ import annotations

from odio_genie import ConfidenceSignals, score


def _doc():
    return {
        "odioVersion": "0.1.0",
        "id": "acme/x",
        "device": {"manufacturer": "Acme", "model": "X"},
        "ports": [
            {
                "id": "p1",
                "direction": "input",
                "connector": "hdmi-type-a",
                "signals": [{"domain": "video", "transport": "hdmi"}],
            }
        ],
        "power": {"consumptionWatts": {"typical": 8, "max": 12}},
    }


def test_no_signals_yields_full_confidence():
    doc = _doc()
    score(doc)
    conf = doc["provenance"]["confidence"]
    assert conf["overall"] == 1.0
    assert "lowConfidenceFields" not in conf


def test_low_field_is_flagged_and_lowers_overall():
    doc = _doc()
    score(doc, ConfidenceSignals(field_confidence={"power.consumptionWatts.max": 0.2}))
    conf = doc["provenance"]["confidence"]
    assert conf["overall"] < 1.0
    assert "power.consumptionWatts.max" in conf["lowConfidenceFields"]


def test_threshold_boundary_is_inclusive():
    doc = _doc()
    score(
        doc,
        ConfidenceSignals(field_confidence={"device.model": 0.6}),
        threshold=0.6,
    )
    assert "device.model" in doc["provenance"]["confidence"]["lowConfidenceFields"]


def test_field_above_threshold_not_flagged():
    doc = _doc()
    score(
        doc,
        ConfidenceSignals(field_confidence={"device.model": 0.61}),
        threshold=0.6,
    )
    assert "lowConfidenceFields" not in doc["provenance"]["confidence"]


def test_score_accepts_plain_dict_signals():
    doc = _doc()
    score(doc, {"field_confidence": {"device.manufacturer": 0.1}})
    assert "device.manufacturer" in doc["provenance"]["confidence"]["lowConfidenceFields"]


def test_provenance_paths_not_scored():
    doc = _doc()
    doc["provenance"] = {"generator": "genie/0.1.0"}
    score(doc)
    low = doc["provenance"]["confidence"].get("lowConfidenceFields", [])
    assert not any(f.startswith("provenance") for f in low)


def test_lowconfidence_fields_sorted_and_unique():
    doc = _doc()
    score(
        doc,
        ConfidenceSignals(
            field_confidence={
                "power.consumptionWatts.max": 0.1,
                "device.model": 0.2,
            }
        ),
    )
    low = doc["provenance"]["confidence"]["lowConfidenceFields"]
    assert low == sorted(low)
    assert len(low) == len(set(low))
