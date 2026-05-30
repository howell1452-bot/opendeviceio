"""Genie - the OpenDeviceIO (ODIO) spec-sheet importer.

Genie turns hardware device datasheets into schema-validated, confidence-flagged
``.odio.json`` drafts using a hybrid LLM-extraction pipeline.

The public surface is intentionally small and import-light: importing this package
(and running the test suite) requires only stdlib + ``jsonschema`` + ``pydantic``.
Heavy, optional dependencies (PDF readers, the Anthropic SDK) are imported lazily,
deep inside the functions that need them, so the core remains usable without them.
"""

from __future__ import annotations

__version__ = "0.1.0"
GENERATOR = f"genie/{__version__}"

from .extractor import Extractor, MockExtractor
from .models import ConfidenceSignals, ExtractedText
from .pipeline import (
    GenieError,
    MissingExtraError,
    assemble,
    build_draft,
    bundle_tool_schema,
    extract,
    ingest,
    load_bundle_schema,
    load_cable_schema,
    load_schema,
    score,
    validate,
    validate_kind,
    write_review_report,
)

__all__ = [
    "__version__",
    "GENERATOR",
    "Extractor",
    "MockExtractor",
    "ExtractedText",
    "ConfidenceSignals",
    "GenieError",
    "MissingExtraError",
    "ingest",
    "extract",
    "validate",
    "score",
    "assemble",
    "build_draft",
    "load_schema",
    "load_bundle_schema",
    "load_cable_schema",
    "bundle_tool_schema",
    "validate_kind",
    "write_review_report",
]
