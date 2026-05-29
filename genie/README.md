# Genie — the OpenDeviceIO spec-sheet importer

**Genie** turns hardware device datasheets into schema-validated, confidence-flagged
[OpenDeviceIO](../docs/DESIGN.md) (`.odio.json`) drafts.

It uses a hybrid pipeline: an LLM extracts an ODIO-shaped candidate, the candidate is
validated against the canonical JSON Schema (`schema/v0.1/device.schema.json`), every
field is confidence-scored, and the result is emitted as a `status: draft` document
plus an optional markdown review report listing the fields a human should verify.

## Design

```
ingest(path) -> ExtractedText        # .pdf (lazy backends) / .txt / .md
extract(text, extractor) -> dict     # candidate ODIO document
validate(doc) -> [errors]            # against the canonical JSON Schema
score(doc, signals) -> doc           # populates provenance.confidence
assemble(doc) -> doc                 # generator=genie/0.1.0, method=llm-extraction,
                                     # validation.status=draft
```

Heavy/optional dependencies are **lazily imported**: importing `odio_genie` and running
the full test suite needs only `jsonschema` + `pydantic` + `pytest`. PDF backends and
the Anthropic SDK are imported only inside the functions that use them, and missing
extras raise a clear, actionable error.

## Install

From the `genie/` directory:

```bash
# core only (validation, scoring, mock extraction)
pip install -e .

# with PDF ingestion (pdfplumber / PyMuPDF)
pip install -e ".[pdf]"

# with the Claude API extractor (anthropic)
pip install -e ".[llm]"

# everything + test tooling
pip install -e ".[pdf,llm,dev]"
```

Python 3.11+ (developed and tested on 3.14).

## Usage

### Parse a datasheet into a draft

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # required for live LLM extraction
genie parse datasheet.pdf -o device.odio.json --review-report report.md
```

Options:

- `-o, --output` — draft `.odio.json` path (required)
- `--review-report PATH` — also write a markdown review report
- `--model` — Claude model id (default `claude-opus-4-8`)
- `--by EMAIL` — record a reviewer in `provenance.validation.by`
- `--mock` — use the deterministic offline extractor (no API key, no network)

Offline smoke test with the mock extractor:

```bash
genie parse datasheet.txt -o device.odio.json --review-report report.md --mock
```

### Validate an existing ODIO file

```bash
genie validate device.odio.json
```

Exit codes: `0` valid / clean draft, `1` invalid or runtime error, `2` draft emitted
but has schema violations, `3` a required optional extra is not installed.

## The Claude extractor

`ClaudeExtractor` calls the Anthropic Messages API with **schema-shaped tool-use**
(`tool_choice` forces the `emit_odio_document` tool whose `input_schema` embeds the
canonical device schema) and **prompt-caches** the schema and few-shot examples for
cost and consistency. The API key is read from `ANTHROPIC_API_KEY` and is never
hardcoded. The default model is `claude-opus-4-8`.

## Develop & test

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -e ".[dev]"
pytest
```

The tests use the deterministic `MockExtractor`, assert the assembled draft validates
against the real schema, exercise the confidence scorer, and run the conformance
corpus (`../examples/*.odio.json` must pass, `../examples/invalid/*.odio.json` must
fail). No network access or PDF libraries are required.
