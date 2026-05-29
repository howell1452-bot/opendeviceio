"""Lightweight typed models for the Genie pipeline.

These are deliberately small pydantic models that describe the *handoff* objects
between pipeline stages (extracted source text, confidence signals). The ODIO
document itself is validated against the canonical JSON Schema rather than mirrored
into pydantic, so the schema stays the single source of truth.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SourceDocument(BaseModel):
    """Provenance record for one ingested source file."""

    title: str
    path: str | None = None
    sha256: str | None = None
    pages: int | None = None


class ExtractedText(BaseModel):
    """The text (and any tabular text) pulled out of a source document.

    Returned by :func:`odio_genie.pipeline.ingest`. ``text`` is the linearized,
    extraction-ready body; ``source`` carries provenance so it can be threaded into
    the final ODIO document.
    """

    text: str
    source: SourceDocument
    tables: list[str] = Field(default_factory=list)

    @property
    def combined(self) -> str:
        """Text plus any extracted tables, joined for prompting."""
        if not self.tables:
            return self.text
        joined_tables = "\n\n".join(self.tables)
        return f"{self.text}\n\n=== TABLES ===\n\n{joined_tables}"


class ConfidenceSignals(BaseModel):
    """Hints, produced alongside extraction, that drive confidence scoring.

    ``field_confidence`` maps a JSON path (e.g. ``"power.consumptionWatts.max"``) to a
    0..1 confidence. ``notes`` is free-form per-field commentary surfaced in the review
    report. Anything not mentioned is assumed confidently extracted unless the scorer's
    own heuristics flag it.
    """

    field_confidence: dict[str, float] = Field(default_factory=dict)
    notes: dict[str, str] = Field(default_factory=dict)

    def merged_with(self, other: "ConfidenceSignals | None") -> "ConfidenceSignals":
        if other is None:
            return self
        return ConfidenceSignals(
            field_confidence={**self.field_confidence, **other.field_confidence},
            notes={**self.notes, **other.notes},
        )


def as_signals(value: ConfidenceSignals | dict[str, Any] | None) -> ConfidenceSignals:
    """Coerce a dict or ``None`` into a :class:`ConfidenceSignals`."""
    if value is None:
        return ConfidenceSignals()
    if isinstance(value, ConfidenceSignals):
        return value
    return ConfidenceSignals(**value)
