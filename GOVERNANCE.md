# OpenDeviceIO Governance

OpenDeviceIO (ODIO) is an **open standard**. Its value depends on being a neutral,
predictable contract that any manufacturer or software vendor can build on without
favoring one party. This document describes how the project is governed: how decisions
are made, who makes them, how the format evolves under semantic versioning, and how
vendor neutrality is preserved.

## Principles

1. **Vendor-neutral.** ODIO favors no single design tool, manufacturer, or vendor. The
   core schema describes objective device facts. Vendor- or tool-specific needs live
   under `x-` namespaces (see "Vendor neutrality" below) and **never** in the core.
2. **One source of truth.** `schema/v0.1/device.schema.json` is canonical. The spec and
   the SDK types are derived from it.
3. **Stability over churn.** The core stays small and changes slowly, with strict
   semantic-versioning discipline so existing files keep validating.
4. **Open process.** Changes are proposed in the open via RFC-in-PR (see
   [CONTRIBUTING.md](CONTRIBUTING.md)) and decided transparently.
5. **Conformance is objective.** A file is conformant **iff** it validates against the
   schema. Governance never adds hidden conformance rules outside the schema.

## Roles

- **Contributors** — anyone who opens an issue or pull request. No prior status required.
- **Maintainers** — individuals with merge rights who review contributions, uphold these
  principles, and steward the schema, spec, examples, and tooling. Maintainers act on
  behalf of the standard, not their employer.
- **Steering group** — the set of maintainers acting collectively for decisions that
  affect the format itself (normative changes, releases, roadmap, adding/removing
  maintainers).

New maintainers are nominated by an existing maintainer based on a track record of
quality contributions and are confirmed by maintainer consensus (see below). Maintainers
who become inactive or who repeatedly act against these principles may be moved to
emeritus status by the same process. No single organization should hold a majority of
maintainer seats; the steering group SHOULD actively recruit across vendors and
manufacturers to avoid capture.

## Decision process

We decide by **lazy consensus**, escalating only when needed:

1. **Editorial / non-normative changes** (typos, docs wording, test/tooling fixes that
   do not change what validates): one maintainer approval and passing CI.
2. **Normative changes** (schema, spec semantics, vocabularies, releases): proposed as an
   RFC-in-PR. After adequate review time (at least a few business days for non-trivial
   changes), the change proceeds if there is **consensus** — at least two maintainer
   approvals from **different organizations** where possible, and **no unresolved
   blocking objection** from any maintainer. A blocking objection must include a concrete
   reason and, ideally, an alternative.
3. **Disputes** that consensus cannot resolve are decided by a simple majority vote of the
   steering group. Votes and their rationale are recorded in the relevant issue or PR.

Maintainers MUST recuse themselves from decisions where they have a direct conflict of
interest (e.g. a change that exists solely to serve their employer's product).

## Semantic-versioning discipline

The format version (`odioVersion`) and the schema follow semver. The steering group
enforces:

- **PATCH** — editorial / non-normative clarifications. Nothing that validated before
  stops validating.
- **MINOR** — **additive and backward-compatible only**: new **optional** fields and new
  **vocabulary entries** (connectors, transports, link types, categories). A document
  valid under `X.Y` MUST remain valid under `X.(Y+1)`. This is the normal path for
  growth, including new vocabulary terms.
- **MAJOR** — backward-incompatible changes (new required fields, changed semantics,
  removed vocabulary). Reserved for genuine necessity; requires explicit steering-group
  agreement and a migration note.

The `$schema` URL is versioned by MAJOR.MINOR (`/schema/v0.1/…`). A published schema
version is **frozen**: fixes that would change validation results ship as a new version,
not as edits to an existing one.

## Vendor neutrality and the `x-` namespace

The core schema sets `additionalProperties: false` and allows extension keys matching
`^x-` at every object level. This is the mechanism that keeps the standard neutral:

- **Vendor and tool needs go under `x-`** (e.g. `x-dtools`, `x-avcad`, `x-<vendor>`),
  never in the core. Consumers ignore `x-` keys they do not understand.
- A field is eligible for the **core** only if it is **vendor-neutral**, describes an
  objective device fact, and is broadly useful across the ecosystem — not a single
  vendor's feature. Proposals that fail this test are declined for the core and pointed
  to `x-`.
- Vocabulary additions follow the same bar: a `connector`/`transport`/`standard` term is
  added only when it names something a reasonable third party would recognize, backed by
  at least one real device (see [CONTRIBUTING.md](CONTRIBUTING.md)). Until then, the
  `other` + free-text escape hatch covers it.

## Trademarks and naming

References to manufacturer or product names within data files describe real devices and
are the property of their respective owners; they do not imply endorsement. The project
name and any marks are governed separately from the content license.

## Code of Conduct

All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor
Covenant 2.1). Maintainers are responsible for fair, consistent enforcement.

## Changing this document

Amendments to governance follow the **normative** decision path above (RFC-in-PR plus
steering-group consensus).
