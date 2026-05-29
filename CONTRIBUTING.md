# Contributing to OpenDeviceIO

Thanks for helping build OpenDeviceIO (ODIO) — an open, machine-readable format for
describing hardware device I/O. This guide covers how to propose changes, the repository
layout, how to run the tests, and how vocabularies grow.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
Governance (decision process, roles, neutrality) is described in
[GOVERNANCE.md](GOVERNANCE.md).

## Licensing of contributions

- Code and the JSON Schema are licensed under [Apache-2.0](LICENSE) (with its explicit
  patent grant).
- Specification and documentation prose are licensed under [CC BY 4.0](LICENSE-docs).

By submitting a contribution you agree it is licensed under the license that governs the
files you are changing, and you have the right to submit it (Apache-2.0 §5 inbound = outbound).

## The single source of truth

`schema/v0.1/device.schema.json` is the **canonical contract**. TypeScript types are
generated from it and the prose specification (`docs/SPECIFICATION.md`) is written to
match it. There is exactly one definition of the format. Any change to what validates
**must** start as a change to the schema, accompanied by spec and example updates.

## Proposing changes — RFC-in-PR

We use a lightweight **RFC-in-PR** process. There is no separate RFC repository.

1. **Open an issue first** for anything beyond a typo or obvious bug, describing the
   problem and the proposed direction. This is cheap and avoids wasted work.
2. **Open a pull request** that contains both the change and its rationale:
   - For **normative** changes (schema, spec semantics, vocabularies), include a short
     RFC section in the PR description: **Motivation**, **Proposed change**,
     **Backward-compatibility / semver impact**, **Alternatives considered**.
   - Update **all three** in lockstep where applicable: the schema, `docs/SPECIFICATION.md`,
     and `examples/` (add or adjust a conformant example; add an invalid example if you
     add a new constraint).
3. **CI must pass** (see below). A maintainer reviews; normative changes require the
   approvals and semver discipline described in `GOVERNANCE.md`.
4. Keep PRs focused. One logical change per PR.

Editorial-only changes (typos, wording, broken links in docs) can skip the RFC section
but still go through a PR and CI.

## Repository layout

```
/
├─ schema/v0.1/device.schema.json   # CANONICAL contract (JSON Schema 2020-12) — frozen for v0.1
├─ docs/
│  ├─ DESIGN.md                     # design memo (frozen input)
│  └─ SPECIFICATION.md              # normative spec, written from the schema (CC BY 4.0)
├─ examples/                        # conformant *.odio.json
│  └─ invalid/                      # intentionally non-conformant *.odio.json (must fail)
├─ tools/validate-examples.mjs      # conformance runner (Ajv 2020) used by CI
├─ packages/ts-sdk/                 # @opendeviceio/sdk — generated TS types + Ajv validator + loader
├─ genie/                           # "Genie" importer (Python): spec sheet -> draft .odio.json
├─ package.json                     # root dev tooling (ajv, ajv-formats) + validate:examples script
├─ LICENSE / LICENSE-docs           # Apache-2.0 (code) / CC BY 4.0 (docs)
├─ README.md / CONTRIBUTING.md / GOVERNANCE.md / CODE_OF_CONDUCT.md
└─ .github/workflows/ci.yml         # schema, ts-sdk, genie jobs
```

## Running the tests locally

### Conformance / schema check (Node)

Validates every `examples/*.odio.json` against the schema and confirms every
`examples/invalid/*.odio.json` fails:

```bash
npm install
npm run validate:examples
# (equivalently: node tools/validate-examples.mjs)
```

The script exits non-zero if any valid example fails or any invalid example passes. This
is exactly what the `schema` CI job runs.

### TypeScript SDK tests

```bash
cd packages/ts-sdk
npm ci        # or: npm install
npm run build
npm test
```

### Genie (Python) tests

```bash
cd genie
python -m pip install -e ".[dev]"
pytest
```

The Genie LLM extraction step is mocked in tests, so no API key or network is needed to
run `pytest`.

> The root `package.json` intentionally does **not** declare npm workspaces, so the
> SDK and Genie jobs install from their own package directories independently.

## Adding to the vocabularies (connectors / transports / standards)

The controlled vocabularies — `connector`, each domain's `transport`, `link.type`,
`standard.category`, and similar enums — are deliberately curated. To add a term:

1. **Use the escape hatch in the meantime.** Every vocabulary has an `other` value plus a
   free-text companion (`connectorOther`, `transportOther`, `typeOther`, or
   `standard.name`). A missing term **never** blocks a valid file, so there is no urgency
   that justifies bending the core.
2. **Propose the addition** via the RFC-in-PR process. New vocabulary entries are
   **additive** and ship in a **MINOR** release (a document valid under `X.Y` stays valid
   under `X.(Y+1)`). Include: the term, where it belongs, why it is broadly useful
   (not a single vendor's product name), and at least one real device that uses it.
3. **Add an example** under `examples/` that uses the new term so it is covered by the
   conformance suite.

Vendor-specific needs do **not** go into the vocabularies or the core — they belong under
an `x-` namespace (see `GOVERNANCE.md` and `docs/SPECIFICATION.md` §4).

## Style

- Schema and JSON: 2-space indentation, valid JSON (no comments in `.odio.json` files).
- Keep examples realistic and minimal; prefer a real device over an invented one when it
  illustrates the same point.
- Spec prose uses RFC 2119 keywords (MUST/SHOULD/MAY) only when stating real requirements.
