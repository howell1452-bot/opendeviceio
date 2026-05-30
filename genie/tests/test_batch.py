"""Offline tests for the bulk catalog-ingest pipeline (odio_genie.batch).

These tests touch NO network and require NEITHER anthropic NOR a PDF backend. A fake
batch extractor is injected via ``extractor_factory`` so the orchestrator's
discover -> extract -> validate/score/assemble -> escalate -> write flow can be exercised
deterministically. The fake returns canned candidates keyed by ``custom_id`` (slug):

* a high-confidence valid doc      -> should NOT be escalated
* a low-confidence valid doc       -> SHOULD be escalated, improved on the 2nd pass
* a schema-invalid doc             -> SHOULD be escalated, fixed on the 2nd pass
"""

from __future__ import annotations

import copy
import json

import pytest

from odio_genie import MockExtractor
from odio_genie.batch import (
    Candidate,
    discover_documents,
    ingest_directory,
    slugify,
)
from odio_genie.models import ConfidenceSignals
from odio_genie.pipeline import _leaf_paths


# A known schema-valid device document (the deterministic mock candidate).
def _valid_doc() -> dict:
    return copy.deepcopy(MockExtractor().extract(""))


def _all_low_signals(doc: dict, conf: float = 0.2) -> ConfidenceSignals:
    """Mark every leaf field low so the draft's overall confidence falls below threshold."""
    fields = [f for f in _leaf_paths(doc) if not f.startswith("provenance")]
    return ConfidenceSignals(field_confidence={f: conf for f in fields})


def _invalid_doc() -> dict:
    # Drop the required `device` block -> guaranteed schema-invalid.
    doc = _valid_doc()
    doc.pop("device", None)
    return doc


# Per-doc text fixtures -> slug.  slugify("high.txt") == "high", etc.
HIGH = "high"
LOW = "low"
BAD = "bad"


def _write_inputs(tmp_path):
    for name in ("high.txt", "low.txt", "bad.txt"):
        (tmp_path / name).write_text(f"datasheet {name}", encoding="utf-8")
    return tmp_path


class _FakeBatchExtractor:
    """A fake honoring the extract_batch(items) -> {custom_id: Candidate} contract.

    Returns different canned candidates depending on the model it was constructed with,
    so the escalation pass (Sonnet) returns *improved* results for the weak docs.
    """

    def __init__(self, *, model: str, **_kwargs):
        self.model = model
        self.calls: list[dict[str, str]] = []

    def extract_batch(self, items):
        self.calls.append(dict(items))
        is_escalation = "sonnet" in self.model
        out: dict[str, Candidate] = {}
        for custom_id in items:
            out[custom_id] = self._candidate_for(custom_id, is_escalation)
        return out

    def _candidate_for(self, custom_id: str, is_escalation: bool) -> Candidate:
        if custom_id == HIGH:
            # High-confidence valid on the first (Haiku) pass.
            return Candidate(_valid_doc(), ConfidenceSignals())
        if custom_id == LOW:
            if is_escalation:
                # Sonnet fixes the confidence.
                return Candidate(_valid_doc(), ConfidenceSignals())
            # Haiku: valid but low confidence everywhere -> overall below threshold.
            doc = _valid_doc()
            return Candidate(doc, _all_low_signals(doc))
        if custom_id == BAD:
            if is_escalation:
                # Sonnet returns a schema-valid doc.
                return Candidate(_valid_doc(), ConfidenceSignals())
            # Haiku returns a schema-invalid doc.
            return Candidate(_invalid_doc(), ConfidenceSignals())
        raise AssertionError(f"unexpected custom_id {custom_id!r}")


def _make_factory():
    created: list[_FakeBatchExtractor] = []

    def factory(*, schema, kind, model):
        ext = _FakeBatchExtractor(model=model)
        created.append(ext)
        return ext

    return factory, created


# --- lazy import rule -------------------------------------------------------------


def test_importing_batch_does_not_require_anthropic(monkeypatch):
    """odio_genie.batch must import with anthropic NOT importable (lazy-import rule)."""
    import builtins
    import importlib

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "anthropic" or name.startswith("anthropic."):
            raise ModuleNotFoundError("No module named 'anthropic'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    import odio_genie.batch as batch_mod

    # Reimport from scratch to prove module import never pulls anthropic.
    importlib.reload(batch_mod)
    assert hasattr(batch_mod, "ingest_directory")
    assert hasattr(batch_mod, "BatchExtractor")


# --- discovery + slug -------------------------------------------------------------


def test_slugify():
    assert slugify("Acme EXT-100 (rev A).pdf") == "acme-ext-100-rev-a"
    assert slugify("____.txt") == "doc"


def test_discover_documents_recursive(tmp_path):
    (tmp_path / "a.txt").write_text("x", encoding="utf-8")
    (tmp_path / "b.md").write_text("x", encoding="utf-8")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "c.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "ignore.csv").write_text("x", encoding="utf-8")

    found = discover_documents(tmp_path)
    names = {p.name for p in found}
    assert names == {"a.txt", "b.md", "c.pdf"}


# --- the end-to-end pipeline ------------------------------------------------------


def test_ingest_directory_writes_drafts_and_manifest(tmp_path):
    src = tmp_path / "in"
    src.mkdir()
    _write_inputs(src)

    out = tmp_path / "out"
    factory, created = _make_factory()

    manifest = ingest_directory(
        src,
        out,
        confidence_threshold=0.6,
        extractor_factory=factory,
    )

    # manifest.json on disk matches the returned dict.
    on_disk = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk["counts"] == manifest["counts"]

    by_slug = {d["slug"]: d for d in manifest["documents"]}
    assert set(by_slug) == {HIGH, LOW, BAD}

    # Every doc wrote a draft + a review report.
    for doc in manifest["documents"]:
        assert (out / doc["draft"]).is_file()
        assert (out / doc["review"]).is_file()

    # Two passes happened: one Haiku batch (3 docs), one Sonnet batch (the 2 weak docs).
    assert len(created) == 2
    haiku, sonnet = created
    assert set(haiku.calls[0]) == {HIGH, LOW, BAD}
    assert set(sonnet.calls[0]) == {LOW, BAD}


def test_high_confidence_not_escalated_weak_are(tmp_path):
    src = tmp_path / "in"
    src.mkdir()
    for name in ("high.txt", "low.txt", "bad.txt"):
        (src / name).write_text(f"datasheet {name}", encoding="utf-8")
    out = tmp_path / "out"
    factory, _ = _make_factory()

    manifest = ingest_directory(
        src, out, confidence_threshold=0.6, extractor_factory=factory
    )
    by_slug = {d["slug"]: d for d in manifest["documents"]}

    # High-confidence valid doc: kept Haiku, not escalated.
    assert by_slug[HIGH]["escalated"] is False
    assert by_slug[HIGH]["model"].startswith("claude-haiku")
    assert by_slug[HIGH]["valid"] is True

    # Low-confidence doc: escalated to Sonnet and improved (now high confidence).
    assert by_slug[LOW]["escalated"] is True
    assert "sonnet" in by_slug[LOW]["model"]
    assert by_slug[LOW]["valid"] is True
    assert by_slug[LOW]["overallConfidence"] > 0.6

    # Schema-invalid doc: escalated to Sonnet and fixed (now valid).
    assert by_slug[BAD]["escalated"] is True
    assert "sonnet" in by_slug[BAD]["model"]
    assert by_slug[BAD]["valid"] is True

    counts = manifest["counts"]
    assert counts["total"] == 3
    assert counts["valid"] == 3
    assert counts["escalated"] == 2


def test_no_escalate_keeps_haiku_results(tmp_path):
    src = tmp_path / "in"
    src.mkdir()
    for name in ("high.txt", "low.txt", "bad.txt"):
        (src / name).write_text(f"datasheet {name}", encoding="utf-8")
    out = tmp_path / "out"
    factory, created = _make_factory()

    manifest = ingest_directory(
        src,
        out,
        confidence_threshold=0.6,
        escalate=False,
        extractor_factory=factory,
    )
    by_slug = {d["slug"]: d for d in manifest["documents"]}

    # Only one (Haiku) pass; nothing escalated.
    assert len(created) == 1
    assert all(d["escalated"] is False for d in manifest["documents"])
    # The bad doc stays invalid without escalation.
    assert by_slug[BAD]["valid"] is False
    assert manifest["counts"]["valid"] == 2


def test_manifest_records_model_valid_confidence(tmp_path):
    src = tmp_path / "in"
    src.mkdir()
    (src / "high.txt").write_text("only doc", encoding="utf-8")
    out = tmp_path / "out"
    factory, _ = _make_factory()

    manifest = ingest_directory(
        src, out, confidence_threshold=0.6, extractor_factory=factory
    )
    doc = manifest["documents"][0]
    assert doc["model"] == manifest["model"]
    assert doc["valid"] is True
    assert doc["overallConfidence"] == pytest.approx(1.0)
    assert doc["lowConfidenceFieldCount"] == 0
    assert doc["errorCount"] == 0
