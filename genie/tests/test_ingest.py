"""Ingest tests that do not require PDF libraries."""

from __future__ import annotations

import pytest

from odio_genie import GenieError, ingest


def test_ingest_text_file(tmp_path):
    p = tmp_path / "spec.txt"
    p.write_text("Hello device", encoding="utf-8")
    extracted = ingest(p)
    assert extracted.text == "Hello device"
    assert extracted.source.title == "spec.txt"
    assert extracted.source.sha256 and len(extracted.source.sha256) == 64


def test_ingest_markdown_file(tmp_path):
    p = tmp_path / "spec.md"
    p.write_text("# Device\nspecs", encoding="utf-8")
    assert "Device" in ingest(p).text


def test_ingest_missing_file_raises():
    with pytest.raises(GenieError):
        ingest("does-not-exist.txt")


def test_ingest_unsupported_extension(tmp_path):
    p = tmp_path / "spec.csv"
    p.write_text("a,b", encoding="utf-8")
    with pytest.raises(GenieError):
        ingest(p)


def test_combined_includes_tables():
    from odio_genie.models import ExtractedText, SourceDocument

    e = ExtractedText(
        text="body",
        tables=["a | b\n1 | 2"],
        source=SourceDocument(title="t"),
    )
    assert "TABLES" in e.combined
    assert "a | b" in e.combined


def test_pdf_ingest_missing_backend_raises_clear_error(tmp_path, monkeypatch):
    # A .pdf input with no PDF backend installed must raise MissingExtraError, never
    # an ImportError at module import time.
    import builtins

    from odio_genie.pipeline import MissingExtraError

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name in {"pdfplumber", "fitz"}:
            raise ModuleNotFoundError(f"No module named '{name}'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    with pytest.raises(MissingExtraError) as exc:
        ingest(pdf)
    assert "[pdf]" in str(exc.value)
