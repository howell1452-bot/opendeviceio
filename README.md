# OpenDeviceIO (ODIO)

**An open, machine-readable format for describing a hardware device's I/O, power,
physical, and compliance characteristics — plus tooling to author and consume it.**

ODIO files use the `.odio.json` extension. The reference importer is called **Genie**.

- Code & schema: [Apache-2.0](LICENSE) · Spec & docs: [CC BY 4.0](LICENSE-docs)

## The problem

AV and control-systems designers — and the CAD tools they use (AVCAD, D-Tools, XTEN-AV,
Stardraw, and others) — have no universal, machine-readable source of truth for a
device's connectors, signals, power, and control. That data lives in PDF spec sheets and
gets re-keyed by hand into every tool's product database, with errors.

ODIO defines a single file a manufacturer can publish alongside a product's support
documents, describing the device's externally observable I/O accurately enough to draw
with: render the back panel, count and label connectors, route signals, and total
power/heat load.

## The three-layer model (in brief)

A device's ports are the heart of the format. Each **port** separates three things:

1. **Connector** — the physical jack only (RJ45, XLR-3-F, 3.5 mm Euroblock).
2. **Link** — the physical "pipe" the connector provides (1 GbE with 802.3at PoE; USB
   with a 60 W PD budget; single-mode fiber). Link-level facts live here once per port.
3. **Signals** — one or more concurrent **logical flows** the port carries, each in its
   domain (`video`, `audio`, `control`, `network`, `data`, `power`).

This lets one connector carry many flows at once (e.g. one RJ45 carrying Dante + AES67 +
general LAN), and keeps the physical pole count (`poleCount`) separate from the number of
independent signal circuits (`signal.channels`). See the spec for the full model and the
RS-232-vs-8×-GPIO worked example.

```jsonc
{
  "odioVersion": "0.1.0",
  "id": "extron/dtp2-t-211@a",
  "device": { "manufacturer": "Extron", "model": "DTP2 T 211" },
  "ports": [
    {
      "id": "hdmi-in-1", "label": "HDMI INPUT 1", "direction": "input",
      "connector": "hdmi-type-a",
      "signals": [
        { "domain": "video", "transport": "hdmi", "maxResolution": "4096x2160" },
        { "domain": "audio", "transport": "lpcm", "maxChannelsPerCircuit": 8 }
      ]
    }
  ]
}
```

## Repository layout

```
schema/v0.1/device.schema.json   # CANONICAL contract (JSON Schema 2020-12)
docs/SPECIFICATION.md            # normative spec, written from the schema (CC BY 4.0)
docs/DESIGN.md                   # design memo / rationale
examples/                        # conformant *.odio.json (+ invalid/ for tests)
tools/validate-examples.mjs      # conformance runner (Ajv 2020)
packages/ts-sdk/                 # @opendeviceio/sdk — TS types + Ajv validator + loader
genie/                           # "Genie" importer (Python): spec sheet -> draft .odio.json
```

The **JSON Schema is the single source of truth.** The TypeScript types are generated
from it and the specification prose is written to match it.

## Documentation

- [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) — the normative specification (every
  object and `$def`, the three-layer model, versioning, conformance).
- [`docs/DESIGN.md`](docs/DESIGN.md) — the design memo and rationale.

## Quickstart

### Validate the example corpus (Node)

Validates every `examples/*.odio.json` against the schema and confirms every
`examples/invalid/*.odio.json` fails:

```bash
npm install
npm run validate:examples     # node tools/validate-examples.mjs
```

### TypeScript SDK

```bash
cd packages/ts-sdk
npm ci && npm run build && npm test
```

### Genie importer (Python)

```bash
cd genie
python -m pip install -e ".[dev]"
pytest
```

> The `packages/ts-sdk` and `genie` packages are built in their own phases of the project;
> see [`docs/DESIGN.md`](docs/DESIGN.md) for the build plan. The schema, examples, and the
> conformance runner above are usable today.

## Conformance

> A file is **conformant** to ODIO 0.1 if and only if it validates against
> `schema/v0.1/device.schema.json`.

CI runs the conformance runner plus the SDK and Genie test suites
(`.github/workflows/ci.yml`).

## Contributing & governance

- [CONTRIBUTING.md](CONTRIBUTING.md) — RFC-in-PR process, how to run the tests, how
  vocabularies grow.
- [GOVERNANCE.md](GOVERNANCE.md) — decision process, semver discipline, vendor neutrality.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.

## License

- **Code and JSON Schema:** [Apache License 2.0](LICENSE) (with explicit patent grant).
- **Specification and documentation:** [Creative Commons Attribution 4.0 International
  (CC BY 4.0)](LICENSE-docs).
