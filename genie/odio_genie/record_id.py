"""Record id normalization: retired id prefixes.

Python twin of ``packages/ts-sdk/src/record-id.ts``. When a brand's id prefix is
corrected (for example ``attero-tech-by-qsc`` became ``attero-tech``), the registry
renames the records and keeps redirects, and every tool that writes ids rewrites the
retired prefix so it can't come back. The list lives in ``vocab/id-prefixes.json``,
found the same way as the category vocabulary (``ODIO_VOCAB_DIR`` overrides).
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .category import find_vocab_dir


@lru_cache(maxsize=1)
def retired_id_prefixes() -> dict[str, str]:
    """Retired prefix -> current prefix, from ``vocab/id-prefixes.json``."""
    path = find_vocab_dir() / "id-prefixes.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in (data.get("retired") or {}).items()}


def normalize_record_id(record_id: Any) -> Any:
    """Return ``record_id`` with a retired prefix replaced; anything else unchanged."""
    if not isinstance(record_id, str):
        return record_id
    prefix, sep, rest = record_id.partition("/")
    if not sep or not prefix:
        return record_id
    current = retired_id_prefixes().get(prefix)
    return f"{current}/{rest}" if current else record_id


def normalize_document_id(doc: dict[str, Any]) -> dict[str, Any]:
    """Rewrite a retired prefix in ``doc["id"]`` in place; return ``doc``."""
    if "id" in doc:
        doc["id"] = normalize_record_id(doc["id"])
    return doc
