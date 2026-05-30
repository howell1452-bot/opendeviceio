# OpenDeviceIO — Design Memo

**Status:** Draft for review · **Date:** 2026-05-29 · **Format version target:** `0.1.0`

OpenDeviceIO (ODIO) is an open, machine-readable format for describing the
input/output (I/O), power, physical, and compliance characteristics of a hardware
device. It is designed so that **manufacturers** can publish an `.odio.json` file
alongside a product's support documents, and **design software** (AVCAD, D-Tools SI,
XTEN-AV, Stardraw, and others) can import it to produce accurate schematics, one-line
drawings, rack elevations, and load calculations without re-keying data from PDFs.

This memo is the design contract. It is the thing we agree on before building. The
normative, versioned rules live in [`SPECIFICATION.md`](SPECIFICATION.md) (to be
written from this memo).

---

## 1. Goals and non-goals

### Goals
- **One file = one device** that fully describes its externally observable I/O.
- **Accurate enough to draw with.** A design tool should be able to render the back
  panel, count and label connectors, route signals, and total power/heat load.
- **Easy for manufacturers to produce** — ideally auto-drafted from existing spec
  sheets by the Genie importer, then human-reviewed.
- **Easy for software vendors to consume** — stable core schema, strong validation,
  predictable shapes, a typed SDK.
- **Extensible without forking** — vendors add fields via a reserved namespace; the
  core stays small and stable.
- **Open and unencumbered** — Apache-2.0 code, CC-BY-4.0 spec.

### Non-goals (for v1)
- Modeling internal signal flow / DSP routing inside a device.
- Being a full product-catalog / pricing / availability format (we link out instead).
- Real-time/state data. ODIO describes capabilities, not runtime status.
- Replacing control protocols (Dante, NDI, Q-SYS, Crestron). We *reference* them.

---

## 2. Scope of v1

v1 covers **pro-AV and IT/network devices**: displays, switchers, extenders, matrix
switchers, DSPs, amplifiers, microphones, cameras, codecs, network switches, media
players, control processors, PDUs, and similar. The schema is designed to extend to
other domains later, but v1 vocabularies (connectors, signal domains, standards) are
curated for AV + IT.

---

## 3. Document model

An ODIO document is a single JSON object. Top-level shape:

```jsonc
{
  "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
  "odioVersion": "0.1.0",          // format version this file conforms to (semver)
  "id": "extron/dtp2-t-211@a",     // stable, lowercase, URL-safe device identifier
  "device":     { /* identity & classification */ },
  "ports":      [ /* the core: I/O ports */ ],
  "power":      { /* power inputs, consumption, heat */ },
  "physical":   { /* dimensions, weight, rack units, mounting */ },
  "standards":  [ /* compliance & interop standards */ ],
  "parameters": { /* free-form parametric data */ },
  "provenance": { /* where this data came from, validation status */ }
  // x-* keys permitted at any object level for vendor extensions
}
```

### 3.1 `device` — identity & classification

```jsonc
{
  "manufacturer": "Extron",
  "model": "DTP2 T 211",
  "revision": "A",                  // optional hardware revision
  "category": "av/extender/transmitter",  // dotted taxonomy path (controlled vocab)
  "productLine": "DTP2",            // optional
  "gtin": "00123456789012",        // optional GTIN/UPC/EAN
  "sku": "60-1644-12",             // optional manufacturer SKU
  "productUrl": "https://...",     // optional canonical product page
  "datasheetUrl": "https://...",   // optional
  "releaseDate": "2021-03-01"      // optional (ISO 8601 date)
}
```

`manufacturer` and `model` are required. `id` is derived as
`slug(manufacturer)/slug(model)[@slug(revision)]` and is the join key tools use.

### 3.2 `ports` — the heart of the format

A **port** is one externally accessible connector (or a group of identical ones). One
physical connector can carry multiple **signal domains** (e.g. HDMI carries video +
audio + control).

```jsonc
{
  "id": "hdmi-in-1",               // unique within the device
  "label": "HDMI INPUT 1",         // as silkscreened on the device
  "direction": "input",            // input | output | bidirectional
  "connector": "hdmi-type-a",      // controlled connector vocabulary
  "count": 1,                      // >1 means N identical ports collapsed into one entry
  "signals": [                     // one or more signal domains on this connector
    {
      "domain": "video",
      "standard": "hdmi-2.0",
      "maxResolution": "4096x2160",
      "maxRefreshHz": 60,
      "colorDepthBits": 12,
      "hdcp": "2.2",
      "chromaSubsampling": "4:4:4"
    },
    {
      "domain": "audio",
      "format": "lpcm",            // embedded in HDMI
      "maxChannels": 8
    }
  ],
  "location": { "face": "rear", "group": "inputs", "order": 1 },  // optional layout hint
  "notes": "Supports HDR10."       // optional
}
```

**Signal domains** (each with its own attribute set, validated by domain):

| Domain     | Key attributes (illustrative) |
|------------|-------------------------------|
| `video`    | `standard` (hdmi-2.0, dp-1.4, sdi-12g…), `maxResolution`, `maxRefreshHz`, `colorDepthBits`, `hdcp`, `chromaSubsampling` |
| `audio`    | `format` (analog-line, analog-mic, aes3, dante, aes67, lpcm…), `maxChannels`, `levelDbu`, `impedanceOhms`, `sampleRateHz`, `bitDepth`, `phantomPower` |
| `network`  | `speed` (100m, 1g, 2.5g, 10g…), `poe` { `standard` (802.3af/at/bt), `role` (pse/pd), `classWatts` }, `protocols` (dante, ndi, aes67, sdvoe…) |
| `control`  | `protocol` (rs-232, rs-485, ir, gpio, contact-closure, relay, ethernet…), `baud`, `pinout`, `roles` |
| `power`    | see `power` block; a port may also *deliver* power (e.g. USB-PD, PoE PSE) |
| `usb`      | `version` (2.0, 3.2-gen2, usb4…), `role` (host/device/dual), `powerDeliveryW` |

This is a **closed core with an open edge**: the `domain` enum and the per-domain
required fields are fixed by the schema; unknown attributes under `x-` are allowed.

**Connector vocabulary** (controlled list, extensible): `hdmi-type-a`, `hdmi-type-d`,
`displayport`, `mini-displayport`, `usb-c`, `usb-a`, `usb-b`, `rj45`, `sfp`, `sfp+`,
`xlr-3-m`, `xlr-3-f`, `euroblock-3.5mm`, `euroblock-5.08mm`, `phoenix`, `rca`, `bnc`,
`f-type`, `db9`, `db25`, `terminal-block`, `optical-st`, `optical-sc`, `optical-lc`,
`3.5mm-trs`, `6.35mm-trs`, `speakon`, `iec-c14`, `iec-c20`, `barrel-dc`, … Unknown
connectors use `"connector": "other"` plus `connectorOther` free text, so a file is
never blocked by a missing vocabulary entry.

### 3.3 `power`

```jsonc
{
  "inputs": [
    { "type": "ac", "voltageRange": "100-240V", "frequencyHz": "50/60", "connector": "iec-c14" },
    { "type": "poe", "standard": "802.3at" },
    { "type": "dc", "nominalVoltage": 48, "connector": "barrel-dc" }
  ],
  "consumptionWatts": { "typical": 12, "max": 18, "standby": 0.5 },
  "heatBtuPerHour": 61,            // optional; derivable from watts if absent
  "redundant": false
}
```

### 3.4 `physical`

```jsonc
{
  "dimensionsMm": { "width": 218, "height": 26, "depth": 122 },
  "weightGrams": 540,
  "rackUnits": 0.5,                // 0 for non-rack; 0.5 for half-U etc.
  "rackMountable": true,
  "rackWidth": "half",             // full | half | quarter (optional)
  "mounting": ["surface", "rack", "under-table"],
  "ipRating": "IP20",              // optional
  "color": "black"                 // optional
}
```

### 3.5 `standards`

```jsonc
[
  { "category": "safety",  "name": "UL 62368-1" },
  { "category": "emc",     "name": "FCC Part 15 Class A" },
  { "category": "av",      "name": "HDBaseT", "detail": "Class B / 5Play" },
  { "category": "network", "name": "AES67" },
  { "category": "env",     "name": "RoHS" }
]
```

### 3.6 `parameters`

A free-form object for parametric data not covered by a typed field — operating
temperature range, latency, MTBF, warranty, etc. Keys are strings; values may be
strings, numbers, booleans, or `{ value, unit }` objects. This is the pressure-relief
valve so the format is useful before every attribute has a typed home.

### 3.7 `provenance`

```jsonc
{
  "generator": "genie/0.1.0",      // or "manual", or a manufacturer toolchain id
  "method": "llm-extraction",      // llm-extraction | manual | manufacturer
  "sourceDocuments": [
    { "title": "DTP2 T 211 User Guide", "url": "https://...", "sha256": "…", "retrieved": "2026-05-29" }
  ],
  "validation": {
    "status": "draft",             // draft | reviewed | manufacturer-verified
    "by": "jane@example.com",
    "date": "2026-05-29"
  },
  "confidence": {                  // present for Genie drafts; guides human review
    "overall": 0.82,
    "lowConfidenceFields": ["ports[3].signals[0].hdcp", "power.consumptionWatts.max"]
  }
}
```

Provenance is what makes the format **trustworthy**: a consumer can tell a hand-keyed
draft from a manufacturer-verified file, and a reviewer knows exactly which fields the
importer was unsure about.

---

## 4. Extensibility & versioning

- **Vendor extensions:** any object may contain keys matching `^x-` (e.g.
  `x-dtools`, `x-avcad`). Validators MUST ignore unknown `x-` keys. The core schema
  forbids unknown non-`x-` keys (`additionalProperties: false` on core objects) so that
  drift is caught instead of silently accepted.
- **Format versioning:** `odioVersion` is semver. MINOR adds optional fields; MAJOR may
  change required fields or semantics. The `$schema` URL is versioned
  (`/schema/v0.1/…`). Tools select behavior on the MAJOR.MINOR pair.
- **Vocabulary evolution:** connector/standard/category vocabularies grow in MINOR
  releases. The `other` + free-text escape hatch means a missing term never blocks a
  valid file.

---

## 5. Repository layout (monorepo)

```
/
├─ docs/
│  ├─ DESIGN.md              # this memo
│  ├─ SPECIFICATION.md       # normative spec (CC-BY-4.0)
│  └─ taxonomy/              # connector / category / standard vocabularies (as data)
├─ schema/
│  └─ v0.1/                  # canonical JSON Schema (language-agnostic source of truth)
│     ├─ device.schema.json
│     ├─ port.schema.json
│     ├─ signal.*.schema.json
│     └─ ...
├─ examples/                 # real-world example .odio.json files (+ a few invalid ones for tests)
├─ packages/
│  └─ ts-sdk/                # @opendeviceio/sdk — generated TS types + Ajv validator + loader
├─ genie/                    # Python importer (PDF -> draft .odio.json)
├─ LICENSE                   # Apache-2.0 (code)
├─ LICENSE-docs              # CC-BY-4.0 (spec & docs)
├─ README.md
├─ CONTRIBUTING.md
├─ GOVERNANCE.md             # how the spec evolves (proposal/RFC process)
└─ CODE_OF_CONDUCT.md
```

The **JSON Schema is the canonical source of truth.** TS types are *generated* from it;
the spec prose is written to match it. There is exactly one definition of the format.

---

## 6. Reference tooling

### 6.1 TypeScript SDK (`@opendeviceio/sdk`)
- **Generated types** (`json-schema-to-typescript`) → a typed `Device` interface.
- **Validator** built on **Ajv** with the published schema; returns structured errors.
- **Loader** helpers: `parse(json) -> Device`, `validate(obj) -> Result`, version
  detection, and convenience accessors (e.g. "all input ports", "total power draw").
- Ships as ESM + CJS, fully typed. This is what CAD plugins integrate.

### 6.2 Genie importer (Python)
Hybrid pipeline — LLM extraction with schema-validated, confidence-flagged review:

1. **Ingest:** PDF → text + tables (`pdfplumber` / PyMuPDF). Handle multi-column layouts.
2. **Extract:** prompt the Claude API with structured tool-use to emit ODIO-shaped
   candidates (caching the spec and few-shot examples for cost/consistency).
3. **Validate:** check the candidate against the JSON Schema (`jsonschema`).
4. **Score:** assign per-field confidence; populate `provenance.confidence`.
5. **Emit:** a draft `.odio.json` (status `draft`) + a human-readable review report
   listing low-confidence fields to verify.

CLI: `genie parse datasheet.pdf -o device.odio.json [--review-report report.md]`.
The Claude API key is supplied at runtime (env var); Genie never ships a key.

### 6.3 Validation as a shared contract
The schema + a corpus of valid/invalid example files form a **conformance suite**. Any
implementation (TS, Python, or a third-party tool) can run it to prove compatibility.

---

## 7. Governance (open standard)

- **License:** code Apache-2.0 (explicit patent grant — important for a standard that
  vendors build commercial products on); spec & docs CC-BY-4.0 (vendors may quote/embed).
- **Evolution:** changes proposed as short RFCs in `docs/` via PR; semver discipline;
  a documented vocabulary-addition process so new connectors/standards are low-friction.
- **Neutrality:** the format favors no single design tool. Vendor-specific needs live
  under `x-` namespaces, never in the core.

---

## 8. Open questions to settle during the build
1. **`id` collisions / authority:** is a manufacturer/model slug enough, or do we want
   an optional registry namespace later? (v1: slug is sufficient; design for a future
   registry.)
2. **Multi-variant devices:** kits/families that share a chassis but differ in I/O —
   one file each, or a variant block? (v1 leaning: one file per orderable model.)
3. **Port grouping vs. enumeration:** when is `count > 1` acceptable vs. listing each
   port individually (needed when labels/positions differ)? Spec needs a clear rule.
4. **Units policy:** SI everywhere with explicit unit suffixes in field names
   (`Mm`, `Grams`, `Watts`, `Hz`) vs. `{ value, unit }`. (Leaning: suffixed SI fields in
   the core for ergonomics; `{ value, unit }` only in free-form `parameters`.)

---

## 9. Build plan (phased)

- **Phase A — Canonical core (gating).** JSON Schema for `device`, `port`, signal
  domains, `power`, `physical`, `standards`, `provenance`; taxonomy data files; 3–5
  hand-authored example files; a few intentionally-invalid files. Everything else
  depends on this.
- **Phase B — TS SDK.** Type generation, Ajv validator, loader/accessors, tests against
  the conformance examples.
- **Phase C — Genie importer.** Python pipeline, CLI, schema validation + confidence
  reporting, tests with fixture text (LLM step mocked in CI).
- **Phase D — Repo meta & docs.** SPECIFICATION.md, README, CONTRIBUTING, GOVERNANCE,
  CODE_OF_CONDUCT, CI for schema + both packages, conformance-suite runner.

Phase A is done carefully and first. B, C, and D fan out from the frozen schema.

---

## 10. Bundles & cables (kits / assemblies)

Many products are **kits**: one orderable part number that contains several devices,
often with factory-terminated cables and mounting hardware. Example: the Crestron
**UC-CX100-T-WM** Flex kit = a TSW-1070 touch screen + a **UC Bracket Assembly**
(itself a sub-assembly containing a UC Engine, a USB→Ethernet adapter, and an
HDMI-over-CAT5→USB converter) + a UC-PR transmitter + six factory cables. A design tool
importing the kit must render each device as its **own block**, while the kit part
number must group/bill them together.

### Decisions (agreed)
- **Separate `bundle` document type** (`schema/v0.1/bundle.schema.json`), not an
  overload of `device`. The clean "one file = one device" promise is preserved; the
  device schema is unchanged.
- A bundle has a kit `bundle` identity (the orderable part number) and a `components[]`
  list. Each component is one of:
  - **device** — a full device (inline `device`+`ports`+…, or a `ref` to an external
    device document) with a `quantity` and optional `designator`;
  - **bundle** — a nested sub-assembly (handles UC-BRKT), inline or by `ref`;
  - **cable** — see below;
  - **accessory** — a non-I/O BOM line item (mounting hardware).
- **Inline or by-reference**: components may embed the device/bundle/cable directly, or
  reference it by `{id}`/`{url}` so standalone products aren't duplicated (full
  by-reference resolution lands with the future registry; inline works today).
- **Cables are first-class** (`schema/v0.1/cable.schema.json`): a cable has typed `ends`
  (each an ODIO `connector` + optional gender), the `signals` it `carries` (reusing the
  device signal model — e.g. a DP→HDMI cable carries `video`), `lengthMeters`, and a
  `factoryTerminated` flag. Cables are both BOM line items and, on a schematic, the
  **edges** between devices. Usable inline in a bundle or as a standalone document.
- **Discriminator**: bundle and cable documents carry `kind: "bundle" | "cable"`. Device
  documents have no `kind` (unchanged); a loader routes on `kind` / top-level shape.

### Versioning note
Adding bundles/cables is additive (no change to `device.schema.json`). While pre-1.0 we
keep the new schemas under `schema/v0.1/` to avoid churn; at the first tagged release the
`$schema` URL may bump to `/v0.2/` per the MINOR-bump policy in §4. Bundle examples live
in `examples/bundles/` so the device conformance corpus is unaffected.

### Downstream
Importers expand a bundle into separate device blocks plus cables-as-connections, keyed
by the kit part number (EasySchematic, for instance, has an `isCableAccessory` concept).
The SDK gains bundle types + a `flattenBundle()` helper; adapters expand bundles to
multiple device templates; Genie can detect and emit kits.

---

## 11. Public website & distribution (roadmap — not yet built)

Planned: a project website hosting (1) a **whitepaper** and **manufacturer authoring
guide** for producing `.odio.json` files; (2) a **free, downloadable database** of
community/manufacturer `.odio.json` device & kit files; and (3) a possible **paid hosted
Genie** import service (spec-sheet → draft `.odio.json`). The free spec/SDK/CLI remain
open (Apache-2.0 / CC-BY-4.0); monetization, if any, is the hosted convenience service,
not the standard. To design later: hosting/stack, the device registry (which also
satisfies §8.1 and bundle `ref` resolution), submission/review flow, and billing.
