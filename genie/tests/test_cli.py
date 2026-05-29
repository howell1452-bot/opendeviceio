"""CLI tests: parse (mock), validate (corpus), and missing-extra error paths."""

from __future__ import annotations

import json

import pytest

from odio_genie import validate
from odio_genie.cli import main
from odio_genie.extractor import ClaudeExtractor

from tests.conftest import invalid_examples, valid_examples


def _write_text_datasheet(tmp_path):
    p = tmp_path / "datasheet.txt"
    p.write_text("Acme EXT-100 HDMI to HDBaseT extender.", encoding="utf-8")
    return p


def test_cli_parse_mock_emits_valid_draft(tmp_path, capsys):
    src = _write_text_datasheet(tmp_path)
    out = tmp_path / "device.odio.json"
    report = tmp_path / "report.md"
    rc = main(
        ["parse", str(src), "-o", str(out), "--review-report", str(report), "--mock"]
    )
    assert rc == 0
    assert out.is_file()
    assert report.is_file()
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert validate(doc) == []
    assert doc["provenance"]["validation"]["status"] == "draft"
    captured = capsys.readouterr()
    assert "Draft validates" in captured.out


@pytest.mark.parametrize("path", valid_examples(), ids=lambda p: p.name)
def test_cli_validate_passes_on_valid_examples(path):
    assert main(["validate", str(path)]) == 0


@pytest.mark.parametrize("path", invalid_examples(), ids=lambda p: p.name)
def test_cli_validate_fails_on_invalid_examples(path):
    assert main(["validate", str(path)]) == 1


def test_cli_validate_missing_file_errors(tmp_path):
    assert main(["validate", str(tmp_path / "nope.odio.json")]) == 1


def test_cli_parse_unsupported_input(tmp_path):
    bad = tmp_path / "thing.docx"
    bad.write_text("x", encoding="utf-8")
    assert main(["parse", str(bad), "-o", str(tmp_path / "o.json"), "--mock"]) == 1


def test_claude_extractor_missing_anthropic_raises_clear_error(monkeypatch):
    # Simulate the anthropic package not being installed.
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "anthropic":
            raise ModuleNotFoundError("No module named 'anthropic'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    from odio_genie.pipeline import MissingExtraError, load_schema

    extractor = ClaudeExtractor(schema=load_schema())
    with pytest.raises(MissingExtraError) as exc:
        extractor.extract("some datasheet text")
    assert "anthropic" in str(exc.value)
    assert "[llm]" in str(exc.value)
