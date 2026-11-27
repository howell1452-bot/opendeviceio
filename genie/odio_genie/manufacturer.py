"""Manufacturer names and brand slugs: the Python twin of the SDK's manufacturer.ts.

A registry id's prefix is the brand slug of its manufacturer: the canonical brand
name (curated aliases in ``vocab/manufacturers.json``) slugged exactly like the
database's ``private.brand_slug()``. Genie derives the prefix from here rather than
trusting the id the model wrote.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from typing import Any

from .category import find_vocab_dir

_LEGAL_SUFFIX = re.compile(
    r"\b(inc|incorporated|llc|l\.?l\.?c|ltd|limited|co|company|corp|corporation|gmbh|ag|sa|s\.?a"
    r"|srl|bv|kg|plc|pty|llp|lp)\b\.?$"
)


def manufacturer_key(raw: str) -> str:
    """Comparison key: case/punctuation-insensitive, trailing legal suffixes removed."""
    if not raw:
        return ""
    s = unicodedata.normalize("NFKC", raw).lower()
    s = re.sub(r"\s+", " ", re.sub(r"[.,]", " ", s)).strip()
    # Strip trailing legal-entity suffixes repeatedly ("usl, inc." -> "usl"), as the SDK does.
    while True:
        prev = s
        s = _LEGAL_SUFFIX.sub("", s, count=1).strip()
        if s == prev or not s:
            return s


@lru_cache(maxsize=1)
def manufacturer_aliases() -> dict[str, str]:
    """``manufacturer_key(variant)`` -> canonical name, from ``vocab/manufacturers.json``."""
    path = find_vocab_dir() / "manufacturers.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in (data.get("aliases") or {}).items()}


def normalize_manufacturer(raw: Any) -> Any:
    """Canonical brand name, or the trimmed original when no alias matches."""
    if not isinstance(raw, str):
        return raw
    trimmed = raw.strip()
    if not trimmed:
        return trimmed
    return manufacturer_aliases().get(manufacturer_key(trimmed), trimmed)


def brand_slug(name: str | None) -> str:
    """Identical to SQL ``private.brand_slug()``: accents stripped (NFD), "New Brand & Co" -> "new-brand-and-co"."""
    decomposed = unicodedata.normalize("NFD", name or "")
    s = "".join(c for c in decomposed if not 0x300 <= ord(c) <= 0x36F).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def expected_id_prefix(manufacturer: str | None) -> str | None:
    """The id prefix a record of this manufacturer must use, or None without one."""
    slug = brand_slug(normalize_manufacturer(manufacturer or ""))
    return slug or None
