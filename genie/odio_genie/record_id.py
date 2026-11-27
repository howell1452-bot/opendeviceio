"""Record id normalization: the id prefix is the brand slug.

Python twin of ``packages/ts-sdk/src/record-id.ts``. A registry id looks like
``<brand-slug>/<model-slug>[@<variant>]``, and the database rejects any other prefix
(``id_prefix_mismatch``). Genie never trusts the prefix the model wrote: it rewrites
the id under the brand slug of the document's manufacturer (see
:mod:`odio_genie.manufacturer`) and logs the change. Without a manufacturer, a
retired prefix from ``vocab/id-prefixes.json`` is still rewritten to its current one.
Vocabulary files are found like the category vocabulary (``ODIO_VOCAB_DIR`` overrides).
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

from .category import find_vocab_dir
from .manufacturer import expected_id_prefix

log = logging.getLogger("odio_genie")


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


def document_manufacturer(doc: dict[str, Any]) -> str | None:
    """The manufacturer named by a device, bundle or cable document."""
    for key in ("device", "bundle", "cable"):
        block = doc.get(key)
        if isinstance(block, dict) and isinstance(block.get("manufacturer"), str):
            return block["manufacturer"]
    return None


def with_brand_prefix(record_id: Any, manufacturer: str | None) -> Any:
    """``record_id`` under its manufacturer's brand slug (retired prefixes too)."""
    if not isinstance(record_id, str):
        return record_id
    prefix, sep, rest = record_id.partition("/")
    expected = expected_id_prefix(manufacturer)
    if not sep or not prefix or not expected:
        return normalize_record_id(record_id)
    return f"{expected}/{rest}"


def normalize_document_id(doc: dict[str, Any]) -> dict[str, Any]:
    """Put ``doc["id"]`` under its manufacturer's brand slug, in place; log a rewrite; return ``doc``."""
    if "id" not in doc:
        return doc
    before = doc["id"]
    after = with_brand_prefix(before, document_manufacturer(doc))
    if after != before:
        log.warning("id prefix rewritten to the brand slug: %s -> %s", before, after)
    doc["id"] = after
    return doc
