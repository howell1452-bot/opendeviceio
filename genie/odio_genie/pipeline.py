"""The Genie pipeline: ingest -> extract -> validate -> score -> assemble -> emit.

Only the core stages (validate / score / assemble / emit) and the mockable extraction
interface need to run for the test suite, so this module imports nothing heavier than
stdlib + ``jsonschema`` + ``pydantic`` at import time. PDF readers are imported lazily
inside :func:`ingest`.
"""

from __future__ import annotations

import copy
import datetime as _dt
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from . import __version__
from .extractor import Extractor
from .models import ConfidenceSignals, ExtractedText, SourceDocument, as_signals

GENERATOR = f"genie/{__version__}"
METHOD = "llm-extraction"
ODIO_VERSION = "0.1.0"

# Canonical $id URLs for the three document schemas. bundle/cable $ref device (and
# bundle $refs cable) by these FULL URLs, so all three must live in one referencing
# Registry for cross-refs to resolve offline (no network).
DEVICE_SCHEMA_URL = "https://opendeviceio.org/schema/v0.1/device.schema.json"
BUNDLE_SCHEMA_URL = "https://opendeviceio.org/schema/v0.1/bundle.schema.json"
CABLE_SCHEMA_URL = "https://opendeviceio.org/schema/v0.1/cable.schema.json"

# Top-level "kind" discriminator -> schema $id URL. Device documents have no "kind".
_KIND_TO_URL = {
    "bundle": BUNDLE_SCHEMA_URL,
    "cable": CABLE_SCHEMA_URL,
}

# Fields the scorer treats as the "spine" of a draft. If a heuristic flags any of
# these as low-confidence, reviewers should look first.
_DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6


class GenieError(Exception):
    """Base class for Genie runtime errors surfaced to the CLI."""


class MissingExtraError(GenieError):
    """Raised when an optional dependency (a pip 'extra') is not installed."""


# --- Schema loading ----------------------------------------------------------------


def _candidate_schema_paths(filename: str = "device.schema.json") -> list[Path]:
    """Locations to search for a v0.1 schema file, most-specific first.

    The schemas are frozen repo inputs at ``<repo>/schema/v0.1/<filename>``. The
    package lives at ``<repo>/genie/odio_genie``, so we walk up from here. (The
    ``ODIO_SCHEMA_PATH`` override applies to the device schema; bundle/cable schemas
    are loaded relative to it.)
    """
    here = Path(__file__).resolve()
    rel = Path("schema") / "v0.1" / filename
    return [parent / rel for parent in here.parents]


def find_schema_path() -> Path:
    """Return the path to the canonical device schema, or raise :class:`GenieError`."""
    import os

    override = os.environ.get("ODIO_SCHEMA_PATH")
    if override:
        p = Path(override)
        if p.is_file():
            return p
        raise GenieError(f"ODIO_SCHEMA_PATH points to a missing file: {p}")

    for candidate in _candidate_schema_paths():
        if candidate.is_file():
            return candidate
    raise GenieError(
        "Could not locate schema/v0.1/device.schema.json relative to the package. "
        "Set ODIO_SCHEMA_PATH to point at the canonical schema."
    )


def _find_sibling_schema_path(filename: str) -> Path:
    """Return the path to a schema file sitting next to ``device.schema.json``.

    Resolved relative to :func:`find_schema_path` (so the ``ODIO_SCHEMA_PATH`` override
    is honored), falling back to walking up from the package.
    """
    device_path = find_schema_path()
    sibling = device_path.with_name(filename)
    if sibling.is_file():
        return sibling
    for candidate in _candidate_schema_paths(filename):
        if candidate.is_file():
            return candidate
    raise GenieError(
        f"Could not locate schema/v0.1/{filename} next to the device schema."
    )


@lru_cache(maxsize=4)
def load_schema(path: str | None = None) -> dict[str, Any]:
    """Load and cache the canonical ODIO device JSON Schema as a dict."""
    schema_path = Path(path) if path else find_schema_path()
    with schema_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=4)
def load_bundle_schema() -> dict[str, Any]:
    """Load and cache the ODIO bundle (kit/assembly) JSON Schema as a dict."""
    with _find_sibling_schema_path("bundle.schema.json").open(
        "r", encoding="utf-8"
    ) as fh:
        return json.load(fh)


@lru_cache(maxsize=4)
def load_cable_schema() -> dict[str, Any]:
    """Load and cache the ODIO cable JSON Schema as a dict."""
    with _find_sibling_schema_path("cable.schema.json").open(
        "r", encoding="utf-8"
    ) as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _registry(device_path: str | None = None) -> Registry:
    """Build a ``referencing`` Registry holding device/bundle/cable schemas.

    All three are keyed by their ``$id`` so the FULL-URL cross-refs
    (bundle/cable -> device, bundle -> cable) resolve entirely offline.
    """
    device = load_schema(device_path)
    bundle = load_bundle_schema()
    cable = load_cable_schema()
    resources = [
        (DEVICE_SCHEMA_URL, device),
        (BUNDLE_SCHEMA_URL, bundle),
        (CABLE_SCHEMA_URL, cable),
    ]
    registry = Registry().with_resources(
        [
            (url, Resource.from_contents(schema, default_specification=DRAFT202012))
            for url, schema in resources
        ]
    )
    return registry


def _inline_external_refs(node: Any, mapping: dict[str, str]) -> Any:
    """Rewrite FULL-URL ``$ref``s to local ``#/...`` refs, recursively.

    ``mapping`` maps an external schema ``$id`` URL to a local ``$defs`` key under
    which that schema's body has been embedded.
    """
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                for url, local in mapping.items():
                    if value.startswith(url + "#"):
                        value = "#/$defs/" + local + value[len(url) + 1:]
                        break
                    if value == url:
                        value = "#/$defs/" + local
                        break
                out[key] = value
            else:
                out[key] = _inline_external_refs(value, mapping)
        return out
    if isinstance(node, list):
        return [_inline_external_refs(item, mapping) for item in node]
    return node


def bundle_tool_schema() -> dict[str, Any]:
    """Return a self-contained bundle schema for use as an LLM tool ``input_schema``.

    The on-disk bundle schema ``$ref``s the device and cable schemas by FULL URL, which
    an Anthropic tool ``input_schema`` cannot resolve. This embeds those two schemas
    under ``$defs`` and rewrites the external refs to local ones so the tool schema is
    standalone.
    """
    bundle = copy.deepcopy(load_bundle_schema())
    device = load_schema()
    cable = load_cable_schema()
    mapping = {
        DEVICE_SCHEMA_URL: "_device",
        CABLE_SCHEMA_URL: "_cable",
    }
    inlined = _inline_external_refs(bundle, mapping)
    defs = inlined.setdefault("$defs", {})
    defs["_device"] = _inline_external_refs(copy.deepcopy(device), mapping)
    defs["_cable"] = _inline_external_refs(copy.deepcopy(cable), mapping)
    return inlined


def validate_kind(doc: dict[str, Any]) -> str:
    """Return the document kind: ``"bundle"``, ``"cable"`` or ``"device"``.

    Routing is driven by the top-level ``kind`` discriminator. Device documents have
    no ``kind``; anything unrecognized falls back to ``"device"``.
    """
    kind = doc.get("kind") if isinstance(doc, dict) else None
    if kind in _KIND_TO_URL:
        return kind
    return "device"


@lru_cache(maxsize=8)
def _validator(
    path: str | None = None, kind: str = "device"
) -> Draft202012Validator:
    registry = _registry(path)
    if kind == "bundle":
        schema = load_bundle_schema()
    elif kind == "cable":
        schema = load_cable_schema()
    else:
        schema = load_schema(path)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=registry)


# --- Stage 1: ingest ---------------------------------------------------------------


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def ingest(path: str | Path) -> ExtractedText:
    """Read a source document into :class:`ExtractedText`.

    Supports ``.txt``/``.md`` (stdlib only) and ``.pdf`` (lazy ``pdfplumber``, falling
    back to ``pymupdf``). PDF readers are imported *inside* this function so importing
    the package never requires the ``[pdf]`` extra; a clear :class:`MissingExtraError`
    is raised if neither is installed.
    """
    src = Path(path)
    if not src.is_file():
        raise GenieError(f"Input file not found: {src}")

    suffix = src.suffix.lower()
    sha = _sha256(src)

    if suffix in {".txt", ".md", ".text"}:
        text = src.read_text(encoding="utf-8", errors="replace")
        return ExtractedText(
            text=text,
            source=SourceDocument(title=src.name, path=str(src), sha256=sha),
        )

    if suffix == ".pdf":
        text, tables, pages = _ingest_pdf(src)
        return ExtractedText(
            text=text,
            tables=tables,
            source=SourceDocument(title=src.name, path=str(src), sha256=sha, pages=pages),
        )

    raise GenieError(
        f"Unsupported input type '{suffix}'. Supported: .pdf, .txt, .md."
    )


def _ingest_pdf(src: Path) -> tuple[str, list[str], int]:
    """Extract text + tables from a PDF, lazily importing a PDF backend."""
    # Try pdfplumber first (good table support), then pymupdf.
    try:
        import pdfplumber  # noqa: PLC0415 - lazy by design
    except ModuleNotFoundError:
        pdfplumber = None  # type: ignore[assignment]

    if pdfplumber is not None:
        pages_text: list[str] = []
        tables: list[str] = []
        with pdfplumber.open(str(src)) as pdf:
            for page in pdf.pages:
                pages_text.append(page.extract_text() or "")
                for table in page.extract_tables() or []:
                    rows = [
                        " | ".join("" if c is None else str(c) for c in row)
                        for row in table
                    ]
                    tables.append("\n".join(rows))
            page_count = len(pdf.pages)
        return "\n\n".join(pages_text), tables, page_count

    try:
        import fitz  # PyMuPDF  # noqa: PLC0415 - lazy by design
    except ModuleNotFoundError as exc:
        raise MissingExtraError(
            "Reading PDFs requires a PDF backend. Install one with:  "
            "pip install 'odio-genie[pdf]'"
        ) from exc

    parts: list[str] = []
    with fitz.open(str(src)) as doc:
        for page in doc:
            parts.append(page.get_text())
        page_count = doc.page_count
    return "\n\n".join(parts), [], page_count


# --- Stage 2: extract --------------------------------------------------------------


def extract(text: str, extractor: Extractor) -> dict[str, Any]:
    """Run an :class:`Extractor` over ``text`` and return a candidate ODIO dict."""
    candidate = extractor.extract(text)
    if not isinstance(candidate, dict):
        raise GenieError(
            f"Extractor returned {type(candidate).__name__}, expected a dict."
        )
    return candidate


# --- Stage 3: validate -------------------------------------------------------------


def validate(doc: dict[str, Any], schema_path: str | None = None) -> list[str]:
    """Validate ``doc`` against the schema for its kind; return human-readable errors.

    The schema is selected by the document's ``kind`` discriminator: ``"bundle"`` ->
    bundle schema, ``"cable"`` -> cable schema, otherwise the device schema. All are
    validated against a shared registry so the FULL-URL ``$ref``s between them resolve
    offline. An empty list means the document is valid.
    """
    kind = validate_kind(doc)
    validator = _validator(schema_path, kind)
    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    messages: list[str] = []
    for err in errors:
        location = _json_pointer(err.absolute_path)
        messages.append(f"{location}: {err.message}")
    return messages


def _json_pointer(path: Any) -> str:
    parts = list(path)
    if not parts:
        return "<root>"
    out = ""
    for part in parts:
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out += f".{part}"
    return out.lstrip(".")


# --- Stage 4: score ----------------------------------------------------------------


def _leaf_paths(node: Any, prefix: str = "") -> list[str]:
    """Enumerate JSON paths to every leaf value in a document (for heuristics)."""
    paths: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key.startswith("$") or key.startswith("x-"):
                continue
            child = f"{prefix}.{key}" if prefix else key
            paths.extend(_leaf_paths(value, child))
    elif isinstance(node, list):
        for idx, value in enumerate(node):
            paths.extend(_leaf_paths(value, f"{prefix}[{idx}]"))
    else:
        paths.append(prefix)
    return paths


def score(
    doc: dict[str, Any],
    signals: ConfidenceSignals | dict[str, Any] | None = None,
    *,
    threshold: float = _DEFAULT_LOW_CONFIDENCE_THRESHOLD,
) -> dict[str, Any]:
    """Compute and attach ``provenance.confidence`` to ``doc`` in place; return it.

    The overall score is the mean of per-field confidences. Fields scoring at or below
    ``threshold`` are listed in ``lowConfidenceFields`` for human review. Extractor
    signals override the per-field default; any field the extractor did not mention is
    assumed confidently extracted (1.0).
    """
    sig = as_signals(signals)
    fields = _leaf_paths(doc)
    # Don't score provenance itself.
    fields = [f for f in fields if not f.startswith("provenance")]

    scored: dict[str, float] = {}
    for field in fields:
        scored[field] = float(sig.field_confidence.get(field, 1.0))
    # Include any signalled field that wasn't a discovered leaf (e.g. a field the
    # extractor wanted flagged that maps to an object).
    for field, conf in sig.field_confidence.items():
        scored.setdefault(field, float(conf))

    if scored:
        overall = round(sum(scored.values()) / len(scored), 4)
    else:
        overall = 0.0

    low = sorted(f for f, c in scored.items() if c <= threshold)

    confidence: dict[str, Any] = {"overall": overall}
    if low:
        confidence["lowConfidenceFields"] = low

    provenance = doc.setdefault("provenance", {})
    provenance["confidence"] = confidence
    return doc


# --- Stage 5: assemble -------------------------------------------------------------


def assemble(
    doc: dict[str, Any],
    *,
    source: SourceDocument | None = None,
    validated_by: str | None = None,
) -> dict[str, Any]:
    """Stamp generator/method/validation provenance onto ``doc`` in place; return it.

    Sets ``provenance.generator`` = ``genie/0.1.0``, ``method`` = ``llm-extraction``,
    and ``validation.status`` = ``draft``. Preserves any confidence already attached by
    :func:`score`. Records the source document when provided.

    The document's ``kind`` (if any) is never clobbered, and the top-level ``$schema``
    is set to the device/bundle/cable schema URL matching that kind.
    """
    doc.setdefault("odioVersion", ODIO_VERSION)
    kind = validate_kind(doc)
    doc.setdefault("$schema", _KIND_TO_URL.get(kind, DEVICE_SCHEMA_URL))

    provenance = doc.setdefault("provenance", {})
    provenance["generator"] = GENERATOR
    provenance["method"] = METHOD

    validation = provenance.setdefault("validation", {})
    validation["status"] = "draft"
    if validated_by:
        validation["by"] = validated_by
        validation["date"] = _dt.date.today().isoformat()

    if source is not None:
        record: dict[str, Any] = {"title": source.title}
        if source.sha256:
            record["sha256"] = source.sha256
        record["retrieved"] = _dt.date.today().isoformat()
        provenance["sourceDocuments"] = [record]

    return doc


# --- Orchestration -----------------------------------------------------------------


def build_draft(
    extracted: ExtractedText,
    extractor: Extractor,
    *,
    schema_path: str | None = None,
    validated_by: str | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Run extract -> score -> assemble and return ``(draft, validation_errors)``.

    Validation errors are returned (not raised) so the CLI can still emit a draft for
    review and report the problems - drafts are explicitly ``status: draft``.
    """
    candidate = extract(extracted.combined, extractor)
    score(candidate, extractor.signals())
    assemble(candidate, source=extracted.source, validated_by=validated_by)
    errors = validate(candidate, schema_path)
    return candidate, errors


# --- Review report -----------------------------------------------------------------


def render_review_report(
    doc: dict[str, Any],
    errors: list[str],
    extractor_signals: ConfidenceSignals | None = None,
) -> str:
    """Render a markdown review report listing low-confidence fields and errors."""
    sig = extractor_signals or ConfidenceSignals()
    provenance = doc.get("provenance", {})
    confidence = provenance.get("confidence", {})
    overall = confidence.get("overall")
    low_fields = confidence.get("lowConfidenceFields", [])

    identity = doc.get("device") or doc.get("bundle") or doc.get("cable") or {}
    title = f"{identity.get('manufacturer', '?')} {identity.get('model', '?')}".strip()

    lines: list[str] = []
    lines.append(f"# Genie review report - {title}")
    lines.append("")
    lines.append(f"- Document id: `{doc.get('id', '?')}`")
    lines.append(f"- Generator: `{provenance.get('generator', '?')}`")
    lines.append(f"- Method: `{provenance.get('method', '?')}`")
    lines.append(f"- Validation status: `{provenance.get('validation', {}).get('status', '?')}`")
    if overall is not None:
        lines.append(f"- Overall confidence: **{overall:.2f}**")
    lines.append("")

    lines.append("## Schema validation")
    if errors:
        lines.append("")
        lines.append(f"This draft has **{len(errors)}** schema violation(s) to fix:")
        lines.append("")
        for err in errors:
            lines.append(f"- `{err}`")
    else:
        lines.append("")
        lines.append("Draft validates cleanly against the ODIO v0.1 schema.")
    lines.append("")

    lines.append("## Fields to verify")
    if low_fields:
        lines.append("")
        lines.append("The importer was unsure about these fields - confirm against the datasheet:")
        lines.append("")
        for field in low_fields:
            note = sig.notes.get(field)
            conf = sig.field_confidence.get(field)
            suffix = ""
            if conf is not None:
                suffix += f" (confidence {conf:.2f})"
            if note:
                suffix += f" - {note}"
            lines.append(f"- `{field}`{suffix}")
    else:
        lines.append("")
        lines.append("No fields fell below the review threshold.")
    lines.append("")

    return "\n".join(lines)


def write_review_report(
    doc: dict[str, Any],
    errors: list[str],
    out_path: str | Path,
    extractor_signals: ConfidenceSignals | None = None,
) -> Path:
    """Write the markdown review report to ``out_path``; return the path."""
    report = render_review_report(doc, errors, extractor_signals)
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report, encoding="utf-8")
    return path


def write_draft(doc: dict[str, Any], out_path: str | Path) -> Path:
    """Write the draft ODIO document as pretty-printed JSON; return the path."""
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return path
