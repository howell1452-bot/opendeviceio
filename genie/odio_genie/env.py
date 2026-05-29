"""Dependency-free ``.env`` loading.

Genie's ClaudeExtractor reads ``ANTHROPIC_API_KEY`` from the process environment.
To make ``genie parse`` convenient without adding a runtime dependency on
``python-dotenv``, the CLI calls :func:`load_dotenv` at startup: it finds the nearest
``.env`` (walking up from the current directory) and loads any keys that are not
already set in the environment. Existing environment variables always win, so an
explicitly exported key is never overridden by a file.
"""

from __future__ import annotations

import os
from pathlib import Path


def find_dotenv(start: str | Path | None = None) -> Path | None:
    """Return the nearest ``.env`` at or above ``start`` (default: cwd), or ``None``."""
    here = Path(start) if start is not None else Path.cwd()
    here = here.resolve()
    for directory in (here, *here.parents):
        candidate = directory / ".env"
        if candidate.is_file():
            return candidate
    return None


def parse_dotenv(text: str) -> dict[str, str]:
    """Parse ``.env`` text into a dict.

    Supports ``KEY=value`` lines, ``export KEY=value``, ``#`` comments, blank lines,
    and single- or double-quoted values. Whitespace around the key and value is
    trimmed. Malformed lines (no ``=``) are ignored.
    """
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        out[key] = value
    return out


def load_dotenv(
    path: str | Path | None = None,
    *,
    override: bool = False,
) -> dict[str, str]:
    """Load a ``.env`` into ``os.environ``; return the keys that were applied.

    If ``path`` is ``None``, the nearest ``.env`` (see :func:`find_dotenv`) is used; if
    none is found, nothing happens and an empty dict is returned. Unless ``override`` is
    true, variables already present in the environment are left untouched.
    """
    dotenv_path = Path(path) if path is not None else find_dotenv()
    if dotenv_path is None or not Path(dotenv_path).is_file():
        return {}

    parsed = parse_dotenv(Path(dotenv_path).read_text(encoding="utf-8"))
    applied: dict[str, str] = {}
    for key, value in parsed.items():
        if override or key not in os.environ:
            os.environ[key] = value
            applied[key] = value
    return applied
