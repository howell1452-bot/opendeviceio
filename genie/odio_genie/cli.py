"""Command-line interface for Genie.

Subcommands:

* ``genie parse <input> -o <out.odio.json> [--review-report report.md] [--model ...]``
  Ingest a datasheet, extract an ODIO draft, score confidence, assemble provenance,
  emit the draft (and optionally a markdown review report).
* ``genie validate <file.odio.json>``
  Validate an existing ODIO document against the canonical schema.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from . import __version__
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
