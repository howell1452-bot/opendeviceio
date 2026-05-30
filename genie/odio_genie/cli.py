"""Command-line interface for Genie.

Subcommands:

* ``genie parse <input> -o <out.odio.json> [--review-report report.md] [--model ...]``
  Ingest a datasheet, extract an ODIO draft, score confidence, assemble provenance,
  emit the draft (and optionally a markdown review report).
* ``genie validate <file.odio.json>``
  Validate an existing ODIO document against the canonical schema.
* ``genie ingest <input_dir> -o <out_dir> [--model ...] [--escalate-model ...]``
  Bulk-ingest a whole directory of datasheets via the Message Batches API: cheap
  Haiku extraction for everything, then a confidence-gated Sonnet re-extraction of the
  weak drafts. Writes one draft + review report per doc plus a manifest.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from . import __version__
from .batch import (
    DEFAULT_BATCH_MODEL,
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_ESCALATE_MODEL,
)
from .env import load_dotenv
from .extractor import DEFAULT_MODEL, ClaudeExtractor, Extractor, MockExtractor
from .pipeline import (
    GenieError,
    MissingExtraError,
    build_draft,
    bundle_tool_schema,
    ingest,
    load_schema,
    validate,
    write_draft,
    write_review_report,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="genie",
        description="Genie - the OpenDeviceIO spec-sheet importer.",
    )
    parser.add_argument("--version", action="version", version=f"genie {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_parse = sub.add_parser(
        "parse", help="Extract a draft .odio.json from a datasheet."
    )
    p_parse.add_argument("input", help="Input datasheet (.pdf, .txt, .md).")
    p_parse.add_argument(
        "-o", "--output", required=True, help="Output .odio.json draft path."
    )
    p_parse.add_argument(
        "--kind",
        choices=("device", "bundle"),
        default="device",
        help="Document kind to extract: a single 'device' (default) or a "
        "'bundle' (kit/assembly with components[]).",
    )
    p_parse.add_argument(
        "--review-report",
        metavar="PATH",
        help="Also write a markdown review report listing low-confidence fields.",
    )
    p_parse.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Claude model id for extraction (default: {DEFAULT_MODEL}).",
    )
    p_parse.add_argument(
        "--mock",
        action="store_true",
        help="Use the deterministic MockExtractor instead of the Claude API "
        "(offline; no API key needed).",
    )
    p_parse.add_argument(
        "--by",
        metavar="EMAIL",
        help="Record this reviewer in provenance.validation.by.",
    )
    p_parse.set_defaults(func=_cmd_parse)

    p_validate = sub.add_parser(
        "validate", help="Validate an existing .odio.json against the schema."
    )
    p_validate.add_argument("file", help="The .odio.json file to validate.")
    p_validate.set_defaults(func=_cmd_validate)

    p_ingest = sub.add_parser(
        "ingest",
        help="Bulk-ingest a directory of datasheets via the Message Batches API.",
        description=(
            "Discover *.pdf / *.txt / *.md under <input_dir>, extract them all in one "
            "Haiku batch (Batches API, half price, prompt-cached), then re-extract any "
            "schema-invalid or low-confidence draft with Sonnet. Writes a draft + "
            "review report per doc and a manifest.json into <out_dir>."
        ),
    )
    p_ingest.add_argument("input_dir", help="Directory of datasheets (searched recursively).")
    p_ingest.add_argument(
        "-o", "--out-dir", required=True, help="Output directory for drafts + manifest."
    )
    p_ingest.add_argument(
        "--kind",
        choices=("device", "bundle"),
        default="device",
        help="Document kind to extract for every doc (default: device).",
    )
    p_ingest.add_argument(
        "--model",
        default=DEFAULT_BATCH_MODEL,
        help=f"Bulk extraction model (default Haiku: {DEFAULT_BATCH_MODEL}).",
    )
    p_ingest.add_argument(
        "--escalate-model",
        default=DEFAULT_ESCALATE_MODEL,
        help=f"Model for re-extracting weak drafts (default Sonnet: {DEFAULT_ESCALATE_MODEL}).",
    )
    p_ingest.add_argument(
        "--no-escalate",
        action="store_true",
        help="Skip the second (escalation) pass; keep the Haiku drafts as-is.",
    )
    p_ingest.add_argument(
        "--no-batch",
        action="store_true",
        help="Use sequential ClaudeExtractor calls instead of the Batches API "
        "(handy for small runs / debug; full price, no batch discount).",
    )
    p_ingest.add_argument(
        "--confidence-threshold",
        type=float,
        default=DEFAULT_CONFIDENCE_THRESHOLD,
        help="Drafts with overall confidence <= this (or schema-invalid) are escalated "
        f"(default {DEFAULT_CONFIDENCE_THRESHOLD}).",
    )
    p_ingest.add_argument(
        "--by",
        metavar="EMAIL",
        help="Record this reviewer in each draft's provenance.validation.by.",
    )
    p_ingest.set_defaults(func=_cmd_ingest)

    return parser


def _make_extractor(args: argparse.Namespace) -> Extractor:
    kind = getattr(args, "kind", "device")
    if args.mock:
        return MockExtractor(kind=kind)
    if kind == "bundle":
        return ClaudeExtractor(
            schema=bundle_tool_schema(), kind="bundle", model=args.model
        )
    return ClaudeExtractor(schema=load_schema(), kind="device", model=args.model)


def _cmd_parse(args: argparse.Namespace) -> int:
    extracted = ingest(args.input)
    extractor = _make_extractor(args)

    draft, errors = build_draft(extracted, extractor, validated_by=args.by)

    out_path = write_draft(draft, args.output)
    print(f"Wrote draft: {out_path}")

    if args.review_report:
        report_path = write_review_report(
            draft, errors, args.review_report, extractor.signals()
        )
        print(f"Wrote review report: {report_path}")

    confidence = draft.get("provenance", {}).get("confidence", {})
    overall = confidence.get("overall")
    if overall is not None:
        print(f"Overall confidence: {overall:.2f}")
    low = confidence.get("lowConfidenceFields", [])
    if low:
        print(f"Low-confidence fields ({len(low)}): {', '.join(low)}")

    if errors:
        print(
            f"\nWARNING: draft has {len(errors)} schema violation(s) - "
            "it is a 'draft' for review:",
            file=sys.stderr,
        )
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 2

    print("Draft validates against the ODIO v0.1 schema.")
    return 0


def _cmd_validate(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        raise GenieError(f"File not found: {path}")
    try:
        doc: Any = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise GenieError(f"{path}: invalid JSON - {exc}") from exc

    errors = validate(doc)
    if errors:
        print(f"INVALID: {path} ({len(errors)} error(s))", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1
    print(f"VALID: {path}")
    return 0


def _cmd_ingest(args: argparse.Namespace) -> int:
    from .batch import ingest_directory

    manifest = ingest_directory(
        args.input_dir,
        args.out_dir,
        kind=args.kind,
        model=args.model,
        escalate_model=args.escalate_model,
        confidence_threshold=args.confidence_threshold,
        escalate=not args.no_escalate,
        use_batch=not args.no_batch,
        validated_by=args.by,
    )

    counts = manifest["counts"]
    print(f"Ingested {counts['total']} document(s) into {manifest['outDir']}")
    print(f"  valid:          {counts['valid']}/{counts['total']}")
    print(f"  escalated:      {counts['escalated']}")
    print(f"  low-confidence: {counts['lowConfidence']}")
    print(f"  manifest:       {Path(manifest['outDir']) / 'manifest.json'}")

    # Non-zero exit if any draft still has schema violations after escalation.
    invalid = counts["total"] - counts["valid"]
    if invalid:
        print(
            f"\nWARNING: {invalid} draft(s) still have schema violations - "
            "see the per-doc .review.md reports.",
            file=sys.stderr,
        )
        return 2
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    # Load a nearby .env (non-overriding) so ANTHROPIC_API_KEY can live in a gitignored
    # file rather than the shell environment. Already-exported vars always win.
    load_dotenv()
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except MissingExtraError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3
    except GenieError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
