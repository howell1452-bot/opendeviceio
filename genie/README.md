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
- `--kind {device,bundle}` — extract a single `device` (default) or a `bundle`
  (a kit/assembly: one orderable part number with a `components[]` list of contained
  devices, nested sub-assemblies, factory-terminated cables, and accessories)

Offline smoke test with the mock extractor:

```bash
genie parse datasheet.txt -o device.odio.json --review-report report.md --mock

# extract a kit/assembly bundle instead of a single device
genie parse kit-datasheet.pdf -o kit.odio.json --kind bundle
```

### Bulk-ingest a catalog of datasheets

`genie ingest` turns a whole directory of spec sheets into reviewed-ready drafts in two
passes over the Anthropic **Message Batches API**:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
genie ingest ./datasheets -o ./drafts
```

What it does, end to end:

1. **Discover** every `*.pdf` / `*.txt` / `*.md` under `<input_dir>` (recursively).
2. **Ingest** each to text (`pipeline.ingest`; the PDF backend stays lazy).
3. **Bulk extract** them all in **one batch** with **Haiku** (`claude-haiku-4-5-20251001`),
   reusing the exact same schema-shaped tool-use and `cache_control`-marked system blocks
   as `ClaudeExtractor` — so prompt caching applies across the whole batch. `custom_id` is
   a slug of the source filename.
4. **Validate + score + assemble** each result into a `status: draft` document.
5. **Escalate** (confidence-gated): any draft that is schema-**invalid** or whose
   `provenance.confidence.overall` is `<= --confidence-threshold` (default `0.6`) is
   re-extracted in a **second batch** with **Sonnet** (`claude-sonnet-4-6`). The better
   result is kept — valid beats invalid, then higher confidence wins.
6. **Write** `<out_dir>/<id-or-slug>.odio.json` + a `.review.md` per doc, plus a
   `manifest.json` summarizing every document (source file, chosen model, valid,
   overall confidence, low-confidence field count, error count).

Options:

- `-o, --out-dir` — output directory for drafts + manifest (required)
- `--model` — bulk extraction model (default Haiku `claude-haiku-4-5-20251001`)
- `--escalate-model` — model for weak drafts (default Sonnet `claude-sonnet-4-6`)
- `--no-escalate` — skip the second pass; keep the Haiku drafts as-is
- `--no-batch` — sequential `ClaudeExtractor` calls instead of the Batches API
  (handy for small runs / debug; full price, no batch discount)
- `--confidence-threshold` — escalation gate (default `0.6`)
- `--kind {device,bundle}` — extract a device (default) or a bundle for every doc
- `--by EMAIL` — record a reviewer in each draft's `provenance.validation.by`

Exit codes: `0` all drafts valid, `2` at least one draft still has schema violations
after escalation (see the per-doc `.review.md`), `3` the `anthropic` extra is missing.

#### Cost story

Bulk catalog ingest is built to be cheap by stacking four levers:

- **Haiku by default** — extraction is structured parsing, not deep reasoning, so the
  cheapest tier handles the bulk of the corpus.
- **Batches API (-50%)** — every batch request runs at half the synchronous token price.
- **Prompt caching** — the schema + few-shot system blocks are identical and
  `cache_control`-marked across every request, so they're billed once and read cheaply
  thereafter.
- **Confidence-gated escalation** — only the documents that actually come back weak are
  re-run on the pricier Sonnet model, so you pay for the strong model exactly where it
  earns its keep.

#### End-to-end catalog workflow

```
acquire PDFs  ->  genie ingest ./datasheets -o ./drafts  ->  review drafts + manifest
              ->  promote the reviewed files  ->  push to the registry
                  with  node ../tools/seed-registry.mjs
```

1. **Acquire** the datasheet PDFs into a directory.
2. **`genie ingest`** to produce drafts + `manifest.json`.
3. **Human review**: open `manifest.json`, work the low-confidence / invalid docs first
   (the `.review.md` reports list exactly which fields to verify), and edit the
   `.odio.json` drafts. Flip `provenance.validation.status` to `published` (and set
   `validation.by`/`date`) once a draft is checked.
4. **Promote** the reviewed `.odio.json` files into the corpus.
5. **Push to the registry** with `tools/seed-registry.mjs`.

### Validate an existing ODIO file

```bash
genie validate device.odio.json   # device, bundle, or cable .odio.json
```

`genie validate` selects the schema from the document's top-level `kind`
discriminator: `bundle` validates against `bundle.schema.json`, `cable` against
`cable.schema.json`, and everything else (no `kind`) against `device.schema.json`.
All three schemas are loaded into one `referencing` registry so the cross-document
`$ref`s (bundle/cable → device, bundle → cable) resolve **offline, with no network**.

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
