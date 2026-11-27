"""Category normalization against the advisory taxonomy in ``<repo>/vocab/``.

``device.category`` / ``bundle.category`` is a free-form taxonomy path under schema
v0.1 (only the pattern ``^[a-z0-9]+(?:/[a-z0-9-]+)*$`` is enforced), so LLM
extraction produces many spellings of one class (``av/accessory/mounting`` vs
``av/accessories/mounting``, ``av/amplifier/multi-channel`` vs ``multichannel``).
Genie normalizes every draft's categories in :func:`odio_genie.pipeline.assemble`.

This is the Python twin of ``normalizeCategory`` in
``packages/ts-sdk/src/category.ts`` and reads the same ``vocab/categories.json`` and
``vocab/category-map.json``. Like the schema (see ``pipeline.find_schema_path``),
the vocab directory is located by walking up from the package to the repo root;
``ODIO_VOCAB_DIR`` overrides that.

Steps (conservative - a wrong merge is worse than a missed one):

1. A path listed in the map returns its controlled path; a controlled path returns
   itself.
2. Unseen input is lightly canonicalized: lowercase, tidy separators, per-segment
   synonyms (``mounting``/``mount-kit`` -> ``mount``, ``accessories`` ->
   ``accessory``, ``multi-channel`` -> ``multichannel`` ...), plural -> singular only
   when the singular is a known segment, and first-segment aliases (``audio`` ->
   ``av``). A mapped/controlled result is returned; so is a controlled path left by
   dropping a legacy leading domain (``av/control/keypad`` -> ``control/keypad``).
3. Otherwise the canonicalized path is returned as-is: an unknown-but-valid path is
   never snapped to a "nearest" controlled category.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from .pipeline import GenieError

_VOCAB_FILES = ("categories.json", "category-map.json")
_NON_SLUG = re.compile(r"[^a-z0-9]+")


def find_vocab_dir() -> Path:
    """Return the directory holding ``categories.json`` / ``category-map.json``.

    ``ODIO_VOCAB_DIR`` wins when set; otherwise walk up from the package (it lives at
    ``<repo>/genie/odio_genie``) to the first ``vocab/`` containing both files.
    """
    override = os.environ.get("ODIO_VOCAB_DIR")
    if override:
        p = Path(override)
        if all((p / name).is_file() for name in _VOCAB_FILES):
            return p
        raise GenieError(f"ODIO_VOCAB_DIR does not contain {', '.join(_VOCAB_FILES)}: {p}")

    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "vocab"
        if all((candidate / name).is_file() for name in _VOCAB_FILES):
            return candidate
    raise GenieError(
        "Could not locate vocab/categories.json relative to the package. "
        "Set ODIO_VOCAB_DIR to point at the repo's vocab/ directory."
    )


@dataclass(frozen=True)
class CategoryVocab:
    """The loaded taxonomy: controlled paths, the old->new map, and the rules."""

    version: str
    labels: dict[str, str]
    mapping: dict[str, str]
    segment_synonyms: dict[str, str]
    root_aliases: dict[str, str]
    known_segments: dict[str, str]


@lru_cache(maxsize=4)
def load_category_vocab(vocab_dir: str | None = None) -> CategoryVocab:
    """Load and cache the category vocabulary (default: :func:`find_vocab_dir`)."""
    directory = Path(vocab_dir) if vocab_dir else find_vocab_dir()
    categories = json.loads((directory / "categories.json").read_text(encoding="utf-8"))
    cmap = json.loads((directory / "category-map.json").read_text(encoding="utf-8"))

    labels = {c["path"]: c["label"] for c in categories["categories"]}
    mapping = {m["from"]: m["to"] for m in cmap["mappings"]}
    synonyms = dict(cmap["rules"]["segmentSynonyms"])
    root_aliases = dict(cmap["rules"]["rootAliases"])

    # Every segment that may appear in a canonical path, keyed by its hyphen-free form.
    known: dict[str, str] = {}
    for path in labels:
        for seg in path.split("/"):
            known[_compact(seg)] = seg
    for seg in synonyms.values():
        known[_compact(seg)] = seg

    return CategoryVocab(
        version=categories["version"],
        labels=labels,
        mapping=mapping,
        segment_synonyms=synonyms,
        root_aliases=root_aliases,
        known_segments=known,
    )


def _compact(segment: str) -> str:
    return segment.replace("-", "")


def _clean(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw).lower()
    segments = (_NON_SLUG.sub("-", seg).strip("-") for seg in text.split("/"))
    return "/".join(seg for seg in segments if seg)


def _lookup_segment(vocab: CategoryVocab, key: str) -> str | None:
    return vocab.segment_synonyms.get(key) or vocab.known_segments.get(key)


def _canonical_segment(vocab: CategoryVocab, segment: str) -> str:
    key = _compact(segment)
    direct = _lookup_segment(vocab, key)
    if direct:
        return direct
    # Plural -> singular only when the singular is a known segment or synonym.
    if key.endswith("s") and not key.endswith("ss"):
        singulars = []
        if key.endswith("ies"):
            singulars.append(key[:-3] + "y")
        if key.endswith("es"):
            singulars.append(key[:-2])
        singulars.append(key[:-1])
        for candidate in singulars:
            hit = _lookup_segment(vocab, candidate)
            if hit:
                return hit
    return segment


def _lookup_path(vocab: CategoryVocab, path: str) -> str | None:
    if path in vocab.mapping:
        return vocab.mapping[path]
    return path if path in vocab.labels else None


def normalize_category(raw: str | None, vocab: CategoryVocab | None = None) -> str | None:
    """Controlled category path for ``raw`` (see the module docstring). Idempotent.

    ``None`` passes through; whitespace-only input returns ``""``.
    """
    if raw is None:
        return None
    vocab = vocab or load_category_vocab()
    trimmed = str(raw).strip()
    cleaned = _clean(trimmed)
    if not cleaned:
        return trimmed

    exact = _lookup_path(vocab, cleaned)
    if exact:
        return exact

    segments = [_canonical_segment(vocab, seg) for seg in cleaned.split("/")]
    alias = vocab.root_aliases.get(segments[0])
    if alias:
        segments[0] = alias
    canonical = "/".join(segments)

    mapped = _lookup_path(vocab, canonical)
    if mapped:
        return mapped

    # Re-root under a controlled domain: "av/control/keypad" -> "control/keypad".
    if len(segments) > 1:
        rest = "/".join(segments[1:])
        if rest in vocab.labels:
            return rest
    return canonical


def is_controlled_category(path: str | None, vocab: CategoryVocab | None = None) -> bool:
    """True when ``path`` is one of the controlled vocabulary paths."""
    if path is None:
        return False
    return path in (vocab or load_category_vocab()).labels


def normalize_document_categories(doc: dict[str, Any]) -> list[tuple[str, str, str]]:
    """Normalize every identity ``category`` in an ODIO document, in place.

    Covers the document's own identity (``device`` / ``bundle`` / ``cable``) and,
    for bundles, each component's ``device`` / ``bundle`` identity recursively.
    Returns ``(json_pointer, old, new)`` for each category that changed.
    """
    changes: list[tuple[str, str, str]] = []
    vocab = load_category_vocab()

    def visit(node: Any, pointer: str) -> None:
        if not isinstance(node, dict):
            return
        for key in ("device", "bundle", "cable"):
            identity = node.get(key)
            if isinstance(identity, dict) and isinstance(identity.get("category"), str):
                old = identity["category"]
                new = normalize_category(old, vocab)
                if new is not None and new != old:
                    identity["category"] = new
                    changes.append((f"{pointer}/{key}/category", old, new))
        # Nested bundle components carry their own components[] beside the identity.
        components = node.get("components")
        if isinstance(components, list):
            for idx, component in enumerate(components):
                visit(component, f"{pointer}/components/{idx}")

    visit(doc, "")
    return changes
