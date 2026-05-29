"""Tests for the dependency-free .env loader."""

from __future__ import annotations

import os

from odio_genie.env import find_dotenv, load_dotenv, parse_dotenv


def test_parse_handles_comments_export_and_quotes() -> None:
    text = (
        "# a comment\n"
        "\n"
        "ANTHROPIC_API_KEY=sk-abc123\n"
        "export FOO=bar\n"
        'QUOTED="hello world"\n'
        "SINGLE='single quoted'\n"
        "NO_EQUALS_LINE\n"
        "EMPTY=\n"
    )
    parsed = parse_dotenv(text)
    assert parsed["ANTHROPIC_API_KEY"] == "sk-abc123"
    assert parsed["FOO"] == "bar"
    assert parsed["QUOTED"] == "hello world"
    assert parsed["SINGLE"] == "single quoted"
    assert parsed["EMPTY"] == ""
    assert "NO_EQUALS_LINE" not in parsed


def test_load_does_not_override_existing_env(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("ANTHROPIC_API_KEY=from-file\n", encoding="utf-8")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-shell")

    applied = load_dotenv(env_file)

    assert "ANTHROPIC_API_KEY" not in applied
    assert os.environ["ANTHROPIC_API_KEY"] == "from-shell"


def test_load_sets_missing_env(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("ODIO_TEST_TOKEN=xyz\n", encoding="utf-8")
    monkeypatch.delenv("ODIO_TEST_TOKEN", raising=False)

    applied = load_dotenv(env_file)

    assert applied == {"ODIO_TEST_TOKEN": "xyz"}
    assert os.environ["ODIO_TEST_TOKEN"] == "xyz"


def test_load_override(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("ODIO_TEST_TOKEN=new\n", encoding="utf-8")
    monkeypatch.setenv("ODIO_TEST_TOKEN", "old")

    load_dotenv(env_file, override=True)

    assert os.environ["ODIO_TEST_TOKEN"] == "new"


def test_find_dotenv_walks_up(tmp_path, monkeypatch) -> None:
    (tmp_path / ".env").write_text("X=1\n", encoding="utf-8")
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    monkeypatch.chdir(nested)

    found = find_dotenv()
    assert found is not None
    assert found == (tmp_path / ".env").resolve()


def test_load_missing_file_is_noop(tmp_path) -> None:
    assert load_dotenv(tmp_path / "does-not-exist.env") == {}
