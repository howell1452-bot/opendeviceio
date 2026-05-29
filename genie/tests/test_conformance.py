"""Conformance: validate() must pass the example corpus and fail the invalid corpus."""

from __future__ import annotations

import json

import pytest

from odio_genie import validate

from tests.conftest import invalid_examples, valid_examples


@pytest.mark.parametrize("path", valid_examples(), ids=lambda p: p.name)
def test_valid_examples_pass(path):
    doc = json.loads(path.read_text(encoding="utf-8"))
    errors = validate(doc)
    assert errors == [], f"{path.name} should be valid but: {errors}"


@pytest.mark.parametrize("path", invalid_examples(), ids=lambda p: p.name)
def test_invalid_examples_fail(path):
    doc = json.loads(path.read_text(encoding="utf-8"))
    errors = validate(doc)
    assert errors, f"{path.name} should fail validation but passed"


def test_corpus_is_non_empty():
    assert valid_examples(), "expected valid example files"
    assert invalid_examples(), "expected invalid example files"
