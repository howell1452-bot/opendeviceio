"""Shared pytest fixtures: locate the frozen repo schema and example corpus."""

from __future__ import annotations

from pathlib import Path

import pytest

# tests/ -> genie/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = REPO_ROOT / "examples"
INVALID_DIR = EXAMPLES_DIR / "invalid"
SCHEMA_PATH = REPO_ROOT / "schema" / "v0.1" / "device.schema.json"


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture(scope="session")
def schema_path() -> Path:
    assert SCHEMA_PATH.is_file(), f"canonical schema missing at {SCHEMA_PATH}"
    return SCHEMA_PATH


def valid_examples() -> list[Path]:
    return sorted(EXAMPLES_DIR.glob("*.odio.json"))


def invalid_examples() -> list[Path]:
    return sorted(INVALID_DIR.glob("*.odio.json"))
