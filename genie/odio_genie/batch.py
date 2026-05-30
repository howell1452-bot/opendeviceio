"""Bulk catalog ingest via the Anthropic Message Batches API.

This module adds a *reproducible bulk pipeline* on top of the single-document
``genie parse`` flow: point it at a directory of datasheets and it ingests every
``.pdf`` / ``.txt`` / ``.md``, extracts them all in **one** Message Batch with a cheap
model (Haiku) by default, validates + scores + assembles each draft, then re-extracts
the weak ones (schema-invalid or low confidence) in a **second** batch with a stronger
model (Sonnet) and keeps the better result.

Cost story: the Batches API is **-50%** versus synchronous calls; Haiku is the
cheapest tier; and the per-doc requests reuse :class:`ClaudeExtractor`'s cached system
blocks (schema + few-shot), so prompt caching applies across the whole batch. Only the
docs that actually need it are escalated to Sonnet.

The ``anthropic`` SDK is imported **lazily** inside :class:`BatchExtractor` so importing
this module (and running the offline test suite) never requires the ``[llm]`` extra. A
missing SDK raises :class:`MissingExtraError` with the ``pip install 'odio-genie[llm]'``
hint. Tests inject a fake batch extractor via ``extractor_factory`` and touch no network.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any, Callable, Protocol

from . import env
from .extractor import (
    DEFAULT_MODEL,
    ClaudeExtractor,
    _tool_schema,
    default_examples,
    estimate_cost,
    usage_dict,
)
from .models import ConfidenceSignals, ExtractedText
from .pipeline import (
    GenieError,
    MissingExtraError,
    assemble,
    bundle_tool_schema,
    ingest,
    load_schema,
    render_review_report,
    score,
    validate,
    write_draft,
)

# Default models for the two-pass strategy. Haiku is the cheap bulk default; any doc
# that comes back weak is escalated to Sonnet. Both are overridable from the CLI.
DEFAULT_BATCH_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_ESCALATE_MODEL = "claude-sonnet-4-6"

# Drafts at or below this overall confidence (or that fail schema validation) are
# escalated to the stronger model in a second batch.
DEFAULT_CONFIDENCE_THRESHOLD = 0.6

# Source document discovery. PDF text extraction is lazy inside ``ingest``.
_SUPPORTED_SUFFIXES = (".pdf", ".txt", ".md")

# Polling guards for the batch job. ``processing_status == "ended"`` is terminal.
_POLL_INITIAL_SECONDS = 2.0
_POLL_MAX_SECONDS = 30.0
_POLL_BACKOFF = 1.5
_MAX_WAIT_SECONDS = 24 * 60 * 60  # batches may take up to 24h; guard against forever.


# --- candidate type ---------------------------------------------------------------


class Candidate:
    """One extraction result for a single document.

    ``document`` is the candidate ODIO dict (``{}`` if the request failed), ``signals``
    are the model's self-reported per-field confidences, and ``error`` carries a
    per-request failure message so one bad doc never crashes the whole batch. ``usage``
    is the request's token counts (input/output/cache) when the API reported them.
    """

    __slots__ = ("document", "signals", "error", "usage")

    def __init__(
        self,
        document: dict[str, Any],
        signals: ConfidenceSignals | None = None,
        error: str | None = None,
        usage: dict[str, int] | None = None,
    ) -> None:
        self.document = document
        self.signals = signals or ConfidenceSignals()
        self.error = error
        self.usage = usage


class BatchExtractorProtocol(Protocol):
    """The injection seam: extract a whole keyed batch in one shot.

    ``items`` maps ``custom_id`` -> source text. Returns ``custom_id`` -> Candidate.
    A real implementation talks to the Batches API; tests supply a fake.
    """

    def extract_batch(self, items: dict[str, str]) -> dict[str, Candidate]:
        ...


# --- slug + discovery -------------------------------------------------------------


def slugify(name: str) -> str:
    """Turn a source filename into a filesystem- and custom_id-safe slug.

    Lowercases, drops the extension, and collapses any run of non-alphanumerics to a
    single hyphen. ``"Acme EXT-100 (rev A).pdf"`` -> ``"acme-ext-100-rev-a"``.
    """
    stem = Path(name).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return slug or "doc"


def discover_documents(input_dir: str | Path) -> list[Path]:
    """Return supported source docs under ``input_dir``, recursively, sorted.

    Sorted for reproducibility. Raises :class:`GenieError` if the directory is missing.
    """
    root = Path(input_dir)
    if not root.is_dir():
        raise GenieError(f"Input directory not found: {root}")
    found: list[Path] = []
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in _SUPPORTED_SUFFIXES:
            found.append(path)
    return sorted(found)


# --- the real batch extractor -----------------------------------------------------


class BatchExtractor:
    """Anthropic Message Batches API wrapper reusing ClaudeExtractor's prompt scaffolding.

    Builds one batch request per document, all sharing the same schema-shaped tool and
    the same ``cache_control``-marked system blocks (so prompt caching applies). Submits
    the batch, polls ``retrieve`` until it ends (with backoff + a max-wait guard), reads
    the results, and maps each result's ``tool_use`` back to a :class:`Candidate` keyed
    by ``custom_id``. Per-request errors are recorded on the Candidate, not raised.
    """

    def __init__(
        self,
        schema: dict[str, Any],
        *,
        kind: str = "device",
        model: str = DEFAULT_BATCH_MODEL,
        examples: list[dict[str, Any]] | None = None,
        max_tokens: int = 8192,
        api_key: str | None = None,
        max_wait_seconds: float = _MAX_WAIT_SECONDS,
        poll_seconds: float = _POLL_INITIAL_SECONDS,
    ) -> None:
        # Reuse ClaudeExtractor for its _system_blocks / _document_key logic so the
        # batch requests are byte-identical to the synchronous path (cache hits).
        self._proto = ClaudeExtractor(
            schema=schema,
            kind=kind,
            model=model,
            examples=examples,
            max_tokens=max_tokens,
            api_key=api_key,
        )
        self.schema = schema
        self.kind = kind
        self.model = model
        self.max_tokens = max_tokens
        self._api_key = api_key
        self.max_wait_seconds = max_wait_seconds
        self.poll_seconds = poll_seconds
        # When set, extract_batch fetches this already-submitted batch instead of
        # creating a new one — lets us recover a completed batch's results (re-fetchable
        # for ~29 days) without re-paying after a downstream parsing failure.
        self.resume_batch_id: str | None = None

    def _client(self) -> Any:
        # Delegates to ClaudeExtractor._client(): lazy ``import anthropic`` raising
        # MissingExtraError if absent, and reads ANTHROPIC_API_KEY.
        return self._proto._client()

    def _request_params(self, text: str) -> dict[str, Any]:
        """The Messages params for one doc — same tool + cached system as ClaudeExtractor."""
        key = self._proto._document_key
        doc_word = "bundle" if self.kind == "bundle" else "device"
        tool = {
            "name": "emit_odio_document",
            "description": f"Emit the extracted ODIO {doc_word} document plus confidence.",
            "input_schema": _tool_schema(self.schema, key=key),
        }
        return {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": self._proto._system_blocks(),
            "tools": [tool],
            "tool_choice": {"type": "tool", "name": "emit_odio_document"},
            "messages": [
                {
                    "role": "user",
                    "content": (
                        f"Extract an ODIO {doc_word} document from this datasheet "
                        "text:\n\n" + text
                    ),
                }
            ],
        }

    def extract_batch(self, items: dict[str, str]) -> dict[str, Candidate]:
        """Submit one batch for all ``items``, poll to completion, map results back."""
        if not items:
            return {}

        client = self._client()
        batch_id = self.resume_batch_id
        if batch_id:
            print(f"Resuming existing batch {batch_id} (no new request submitted).", flush=True)
        else:
            requests = [
                {"custom_id": custom_id, "params": self._request_params(text)}
                for custom_id, text in items.items()
            ]
            batch = client.messages.batches.create(requests=requests)
            batch_id = getattr(batch, "id", None) or batch["id"]
            # Log the id so a completed batch can be recovered with --resume-batch-id
            # if a later step fails (results are re-fetchable for ~29 days).
            print(f"Submitted batch {batch_id} ({len(requests)} requests).", flush=True)

        self._poll_until_ended(client, batch_id)

        results: dict[str, Candidate] = {}
        for result in client.messages.batches.results(batch_id):
            custom_id, candidate = self._parse_result(result)
            results[custom_id] = candidate

        # Any item that produced no result line at all (shouldn't normally happen) gets
        # a recorded error rather than silently vanishing.
        for custom_id in items:
            results.setdefault(
                custom_id,
                Candidate({}, error="No result returned for this request."),
            )
        return results

    def _poll_until_ended(self, client: Any, batch_id: str) -> None:
        deadline = time.monotonic() + self.max_wait_seconds
        wait = self.poll_seconds
        while True:
            batch = client.messages.batches.retrieve(batch_id)
            status = getattr(batch, "processing_status", None) or batch.get(
                "processing_status"
            )
            if status == "ended":
                return
            if time.monotonic() >= deadline:
                raise GenieError(
                    f"Batch {batch_id} did not finish within "
                    f"{self.max_wait_seconds:.0f}s (status={status!r})."
                )
            time.sleep(min(wait, _POLL_MAX_SECONDS))
            wait = min(wait * _POLL_BACKOFF, _POLL_MAX_SECONDS)

    def _parse_result(self, result: Any) -> tuple[str, Candidate]:
        """Map one batch result entry to ``(custom_id, Candidate)``.

        Handles the SDK object shape (attributes) and tolerates per-request errors:
        a non-``succeeded`` result records an error on an empty Candidate.
        """
        custom_id = _get(result, "custom_id")
        inner = _get(result, "result")
        result_type = _get(inner, "type")

        if result_type != "succeeded":
            detail = _describe_error(inner, result_type)
            return custom_id, Candidate({}, error=detail)

        message = _get(inner, "message")
        usage = usage_dict(_get(message, "usage"))
        try:
            document, signals = self._extract_tool_use(message)
        except Exception as exc:  # noqa: BLE001
            # A single malformed message (bad tool args, etc.) must degrade to a
            # recorded per-doc error, never abort parsing of the whole batch.
            return custom_id, Candidate({}, error=f"parse error: {exc}", usage=usage)
        return custom_id, Candidate(document, signals, usage=usage)

    def _extract_tool_use(self, message: Any) -> tuple[dict[str, Any], ConfidenceSignals]:
        key = self._proto._document_key
        tool_input = ClaudeExtractor._first_tool_use(message)
        document = tool_input.get(key, {})
        raw_conf = tool_input.get("_confidence") or {}
        field_confidence: dict[str, float] = {}
        spilled_notes: dict[str, str] = {}
        if isinstance(raw_conf, dict):
            for k, v in raw_conf.items():
                try:
                    field_confidence[k] = float(v)
                except (TypeError, ValueError):
                    # The model occasionally drops a textual rationale into _confidence
                    # instead of a number; keep it as a note rather than crashing.
                    spilled_notes[k] = str(v)
        notes = dict(tool_input.get("_notes") or {})
        notes.update(spilled_notes)
        signals = ConfidenceSignals(field_confidence=field_confidence, notes=notes)
        return document, signals


def _get(obj: Any, name: str) -> Any:
    """Attribute-or-key access — batch result objects are SDK models, fakes are dicts."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _describe_error(inner: Any, result_type: Any) -> str:
    err = _get(inner, "error")
    err_type = _get(err, "type") if err is not None else None
    err_msg = _get(err, "message") if err is not None else None
    label = result_type or "errored"
    if err_msg:
        return f"{label}: {err_msg}"
    if err_type:
        return f"{label}: {err_type}"
    return str(label)


# --- per-doc record + manifest ----------------------------------------------------


def _build_draft_from_candidate(
    candidate: Candidate,
    extracted: ExtractedText,
    *,
    schema_path: str | None,
    threshold: float,
    validated_by: str | None,
) -> tuple[dict[str, Any], list[str]]:
    """Score + assemble a candidate into a draft and return ``(draft, errors)``.

    A candidate that failed extraction (empty document) still yields a draft skeleton
    so the manifest and review report have something to point at; it will simply be
    schema-invalid with zero confidence.
    """
    document = candidate.document if isinstance(candidate.document, dict) else {}
    score(document, candidate.signals, threshold=threshold)
    assemble(document, source=extracted.source, validated_by=validated_by)
    errors = validate(document, schema_path)
    if candidate.error and "<root>: extraction failed" not in errors:
        # Surface the per-request failure as a leading validation note so reviewers see
        # why the draft is empty.
        errors = [f"<root>: extraction failed - {candidate.error}", *errors]
    return document, errors


_USAGE_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


def _empty_usage() -> dict[str, int]:
    return {k: 0 for k in _USAGE_KEYS}


def _add_usage(into: dict[str, int], usage: dict[str, int] | None) -> None:
    if not usage:
        return
    for k in _USAGE_KEYS:
        into[k] = into.get(k, 0) + int(usage.get(k, 0) or 0)


def _doc_usage_and_cost(
    attempts: list[tuple[str, dict[str, int] | None]], *, use_batch: bool
) -> tuple[dict[str, int], float | None]:
    """Sum a document's attempts into total token usage + estimated USD cost.

    Cost is the sum of each attempt's estimated cost (Haiku pass + any Sonnet
    escalation). Returns ``cost = None`` only if no attempt had a known price *and*
    produced usage; otherwise unknown-model attempts contribute 0 to the sum.
    """
    totals = _empty_usage()
    cost = 0.0
    any_cost = False
    for model, usage in attempts:
        _add_usage(totals, usage)
        attempt_cost = estimate_cost(model, usage, batch=use_batch)
        if attempt_cost is not None:
            cost += attempt_cost
            any_cost = True
    return totals, (round(cost, 6) if any_cost else None)


def _overall_confidence(draft: dict[str, Any]) -> float:
    conf = draft.get("provenance", {}).get("confidence", {})
    return float(conf.get("overall", 0.0))


def _low_confidence_count(draft: dict[str, Any]) -> int:
    conf = draft.get("provenance", {}).get("confidence", {})
    return len(conf.get("lowConfidenceFields", []) or [])


def _is_better(
    new_draft: dict[str, Any],
    new_errors: list[str],
    old_draft: dict[str, Any],
    old_errors: list[str],
) -> bool:
    """Escalation tiebreaker: valid beats invalid; then higher overall confidence wins."""
    new_valid = not new_errors
    old_valid = not old_errors
    if new_valid != old_valid:
        return new_valid
    return _overall_confidence(new_draft) > _overall_confidence(old_draft)


# --- the orchestrator -------------------------------------------------------------


def ingest_directory(
    input_dir: str | Path,
    out_dir: str | Path,
    *,
    kind: str = "device",
    model: str = DEFAULT_BATCH_MODEL,
    escalate_model: str = DEFAULT_ESCALATE_MODEL,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    escalate: bool = True,
    use_batch: bool = True,
    fewshot: bool = True,
    schema_path: str | None = None,
    validated_by: str | None = None,
    extractor_factory: Callable[..., BatchExtractorProtocol] | None = None,
    resume_batch_id: str | None = None,
    skip_discontinued: bool = False,
) -> dict[str, Any]:
    """Bulk-ingest every datasheet under ``input_dir`` into drafts + a manifest.

    Pipeline: discover -> ingest -> batch-extract (Haiku) -> validate/score/assemble ->
    escalate the weak ones (Sonnet) -> write ``<out_dir>/<slug>.odio.json`` + ``.review.md``
    per doc, plus ``<out_dir>/manifest.json`` summarizing every document.

    Args:
        model: bulk extraction model (default Haiku).
        escalate_model: model used to re-extract weak docs (default Sonnet).
        confidence_threshold: drafts with ``overall <= threshold`` (or schema-invalid)
            are escalated.
        escalate: set ``False`` to skip the second pass entirely.
        use_batch: when ``False``, fall back to sequential ``ClaudeExtractor`` calls
            (handy for small runs / debug). ``True`` uses the Batches API.
        extractor_factory: injection seam. Called as
            ``extractor_factory(schema=..., kind=..., model=...)`` and must return an
            object with ``extract_batch(items) -> {custom_id: Candidate}``. Tests pass a
            fake here so no network is touched.

    Returns the manifest dict (also written to ``manifest.json``).
    """
    # Pick the right schema for the kind (device default; bundle gets the self-contained
    # tool schema with device/cable embedded).
    if kind == "bundle":
        tool_schema = bundle_tool_schema()
    else:
        tool_schema = load_schema(schema_path)

    factory = extractor_factory or _default_factory(
        use_batch, api_key=None, fewshot=fewshot
    )

    out_root = Path(out_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    docs = discover_documents(input_dir)

    # Ingest all docs to text, assigning a unique slug per doc (dedupe collisions).
    slugs: dict[str, ExtractedText] = {}
    used: set[str] = set()
    order: list[str] = []
    for path in docs:
        extracted = ingest(path)
        slug = slugify(path.name)
        if slug in used:
            n = 2
            while f"{slug}-{n}" in used:
                n += 1
            slug = f"{slug}-{n}"
        used.add(slug)
        slugs[slug] = extracted
        order.append(slug)

    # Optionally drop datasheets that mark the product discontinued (status
    # banners / EOL notices), before any extraction is paid for.
    skipped_discontinued: list[str] = []
    if skip_discontinued:
        pat = re.compile(r"\bdiscontinued\b", re.IGNORECASE)
        kept: list[str] = []
        for slug in order:
            text = slugs[slug].combined or ""
            m = pat.search(text)
            if m:
                ctx = text[max(0, m.start() - 40) : m.end() + 40].replace("\n", " ").strip()
                skipped_discontinued.append(slug)
                print(f"  skip (discontinued): {slug}  …{ctx}…", flush=True)
            else:
                kept.append(slug)
        for slug in skipped_discontinued:
            slugs.pop(slug, None)
        order = kept
        if skipped_discontinued:
            print(f"Skipped {len(skipped_discontinued)} discontinued sheet(s).", flush=True)

    # --- pass 1: bulk extraction (Haiku) ---
    primary = factory(schema=tool_schema, kind=kind, model=model)
    # Recover a previously-submitted, completed batch instead of paying again.
    if resume_batch_id:
        setattr(primary, "resume_batch_id", resume_batch_id)
    items = {slug: extracted.combined for slug, extracted in slugs.items()}
    candidates = primary.extract_batch(items) if items else {}

    drafts: dict[str, dict[str, Any]] = {}
    errors_by_slug: dict[str, list[str]] = {}
    chosen_model: dict[str, str] = {}
    # Every extraction attempt's token usage, per slug, as ``(model, usage)`` so the
    # manifest can sum the Haiku attempt + any Sonnet escalation into a per-doc cost.
    attempts_by_slug: dict[str, list[tuple[str, dict[str, int] | None]]] = {}
    for slug in order:
        candidate = candidates.get(
            slug, Candidate({}, error="No result returned for this request.")
        )
        draft, errors = _build_draft_from_candidate(
            candidate,
            slugs[slug],
            schema_path=schema_path,
            threshold=confidence_threshold,
            validated_by=validated_by,
        )
        drafts[slug] = draft
        errors_by_slug[slug] = errors
        chosen_model[slug] = model
        attempts_by_slug[slug] = [(model, candidate.usage)]

    # --- pass 2: confidence-gated escalation (Sonnet) ---
    escalated_slugs: set[str] = set()
    if escalate and escalate_model and escalate_model != model:
        weak = [
            slug
            for slug in order
            if errors_by_slug[slug]
            or _overall_confidence(drafts[slug]) <= confidence_threshold
        ]
        if weak:
            secondary = factory(
                schema=tool_schema, kind=kind, model=escalate_model
            )
            re_items = {slug: slugs[slug].combined for slug in weak}
            re_candidates = secondary.extract_batch(re_items)
            for slug in weak:
                candidate = re_candidates.get(slug)
                if candidate is None:
                    continue
                # Record the escalation attempt's usage regardless of whether we keep
                # its draft — the API call was still billed.
                attempts_by_slug[slug].append((escalate_model, candidate.usage))
                new_draft, new_errors = _build_draft_from_candidate(
                    candidate,
                    slugs[slug],
                    schema_path=schema_path,
                    threshold=confidence_threshold,
                    validated_by=validated_by,
                )
                if _is_better(
                    new_draft, new_errors, drafts[slug], errors_by_slug[slug]
                ):
                    drafts[slug] = new_draft
                    errors_by_slug[slug] = new_errors
                    chosen_model[slug] = escalate_model
                    escalated_slugs.add(slug)

    # --- write drafts + reports + manifest ---
    manifest_docs: list[dict[str, Any]] = []
    used_stems: set[str] = set()
    # Aggregate token usage + estimated cost across the whole run, and per model.
    total_usage = _empty_usage()
    total_cost = 0.0
    any_cost = False
    cost_by_model: dict[str, dict[str, Any]] = {}
    for slug in order:
        draft = drafts[slug]
        errors = errors_by_slug[slug]
        extracted = slugs[slug]

        # File name keys on the document id when present, else the slug. Two docs that
        # share an id (or have none) must not overwrite each other, so de-collide.
        doc_id = draft.get("id")
        stem = _id_to_stem(doc_id) if doc_id else slug
        if stem in used_stems:
            stem = f"{stem}--{slug}"
            n = 2
            base = stem
            while stem in used_stems:
                stem = f"{base}-{n}"
                n += 1
        used_stems.add(stem)
        draft_path = out_root / f"{stem}.odio.json"
        report_path = out_root / f"{stem}.review.md"

        write_draft(draft, draft_path)
        report = render_review_report(draft, errors)
        report_path.write_text(report, encoding="utf-8")

        doc_usage, doc_cost = _doc_usage_and_cost(
            attempts_by_slug[slug], use_batch=use_batch
        )
        _add_usage(total_usage, doc_usage)
        if doc_cost is not None:
            total_cost += doc_cost
            any_cost = True
        # Per-model breakdown (tokens always; cost only for priced attempts).
        for attempt_model, usage in attempts_by_slug[slug]:
            entry = cost_by_model.setdefault(
                attempt_model, {"usage": _empty_usage(), "estimatedCostUsd": None}
            )
            _add_usage(entry["usage"], usage)
            attempt_cost = estimate_cost(attempt_model, usage, batch=use_batch)
            if attempt_cost is not None:
                entry["estimatedCostUsd"] = round(
                    (entry["estimatedCostUsd"] or 0.0) + attempt_cost, 6
                )

        manifest_docs.append(
            {
                "slug": slug,
                "source": extracted.source.path or extracted.source.title,
                "draft": str(draft_path.name),
                "review": str(report_path.name),
                "model": chosen_model[slug],
                "escalated": slug in escalated_slugs,
                "valid": not errors,
                "overallConfidence": _overall_confidence(draft),
                "lowConfidenceFieldCount": _low_confidence_count(draft),
                "errorCount": len(errors),
                "usage": doc_usage,
                "estimatedCostUsd": doc_cost,
            }
        )

    total = len(manifest_docs)
    manifest = {
        "generator": GENERATOR_LABEL,
        "inputDir": str(Path(input_dir)),
        "outDir": str(out_root),
        "model": model,
        "escalateModel": escalate_model if escalate else None,
        "confidenceThreshold": confidence_threshold,
        "useBatch": use_batch,
        "fewshot": fewshot,
        "usage": total_usage,
        "cost": {
            # ESTIMATE only — the authoritative figure is in the Anthropic Console.
            "estimatedCostUsd": round(total_cost, 6) if any_cost else None,
            "note": (
                "Estimated from approximate per-token pricing; the exact cost is in "
                "the Anthropic Console."
            ),
            "byModel": cost_by_model,
        },
        "counts": {
            "total": total,
            "valid": sum(1 for d in manifest_docs if d["valid"]),
            "escalated": sum(1 for d in manifest_docs if d["escalated"]),
            "lowConfidence": sum(
                1
                for d in manifest_docs
                if d["overallConfidence"] <= confidence_threshold
            ),
            "skippedDiscontinued": len(skipped_discontinued),
        },
        "skippedDiscontinued": skipped_discontinued,
        "documents": manifest_docs,
    }

    import json

    (out_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


GENERATOR_LABEL = "genie-batch/0.1.0"


def _id_to_stem(doc_id: str) -> str:
    """Turn an ODIO id (``acme/ext-100@a``) into a flat, safe filename stem."""
    return re.sub(r"[^A-Za-z0-9._-]+", "-", doc_id).strip("-") or "doc"


# --- sequential fallback (use_batch=False) ----------------------------------------


class _SequentialBatchExtractor:
    """A BatchExtractor-shaped wrapper that calls ClaudeExtractor once per doc.

    Used when ``use_batch=False``: handy for tiny runs or debugging, at full
    (non-batch) price and latency. Keeps the same ``extract_batch`` contract so the
    orchestrator is agnostic to which strategy is in play.
    """

    def __init__(
        self,
        schema: dict[str, Any],
        *,
        kind: str = "device",
        model: str = DEFAULT_BATCH_MODEL,
        examples: list[dict[str, Any]] | None = None,
        api_key: str | None = None,
    ) -> None:
        self._extractor = ClaudeExtractor(
            schema=schema, kind=kind, model=model, examples=examples, api_key=api_key
        )

    def extract_batch(self, items: dict[str, str]) -> dict[str, Candidate]:
        results: dict[str, Candidate] = {}
        for custom_id, text in items.items():
            try:
                document = self._extractor.extract(text)
                results[custom_id] = Candidate(
                    document,
                    self._extractor.signals(),
                    usage=self._extractor.last_usage,
                )
            except (GenieError, MissingExtraError):
                raise
            except Exception as exc:  # pragma: no cover - defensive per-doc guard
                results[custom_id] = Candidate({}, error=str(exc))
        return results


def _default_factory(
    use_batch: bool, *, api_key: str | None, fewshot: bool = True
) -> Callable[..., BatchExtractorProtocol]:
    """Return the real extractor factory used when no ``extractor_factory`` is injected.

    Loads ``.env`` so ``ANTHROPIC_API_KEY`` can live in a gitignored file, then returns
    a factory producing either a :class:`BatchExtractor` (Batches API) or a
    :class:`_SequentialBatchExtractor` (one synchronous call per doc). When ``fewshot``
    is set (default), the curated few-shot examples for the kind are attached as a
    cached system block so Haiku sees a worked example — amortized across the batch.
    """
    env.load_dotenv()

    def factory(
        *, schema: dict[str, Any], kind: str, model: str
    ) -> BatchExtractorProtocol:
        examples = default_examples(kind) if fewshot else None
        if use_batch:
            return BatchExtractor(
                schema=schema,
                kind=kind,
                model=model,
                examples=examples,
                api_key=api_key,
            )
        return _SequentialBatchExtractor(
            schema=schema,
            kind=kind,
            model=model,
            examples=examples,
            api_key=api_key,
        )

    return factory
