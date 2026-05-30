import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "The OpenDeviceIO whitepaper: motivation, the data model, bundles and cables, governance and licensing, and the roadmap."
};

const TOC = [
  ["motivation", "1. Motivation"],
  ["model", "2. The data model"],
  ["three-layer", "3. The three-layer port model"],
  ["bundles", "4. Bundles & cables"],
  ["provenance", "5. Provenance & trust"],
  ["extensibility", "6. Extensibility & versioning"],
  ["governance", "7. Governance & licensing"],
  ["roadmap", "8. Roadmap"]
] as const;

export default function WhitepaperPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
        {/* TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Contents
            </div>
            <nav className="mt-3 space-y-1.5 text-sm">
              {TOC.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="block text-slate-600 hover:text-brand-700"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <article className="prose-odio max-w-none">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
            Whitepaper · v0.1.0
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            OpenDeviceIO: a portable contract for hardware device I/O
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            OpenDeviceIO (ODIO) is an open, machine-readable format for describing
            the input/output, power, physical, and compliance characteristics of a
            hardware device. One file, published by a manufacturer alongside a
            product&apos;s support documents, lets design software import accurate
            device data instead of re-keying it from PDFs.
          </p>

          <h2 id="motivation">1. Motivation</h2>
          <p>
            AV and control-systems designers — and the CAD tools they use (AVCAD,
            D-Tools SI, XTEN-AV, Stardraw, and others) — have no universal,
            machine-readable source of truth for a device&apos;s connectors,
            signals, power, and control. That data lives in PDF spec sheets and is
            re-keyed by hand into every tool&apos;s product database, with errors,
            duplication, and drift.
          </p>
          <p>
            ODIO&apos;s goal is <strong>one file = one device</strong>, accurate
            enough to draw with: a design tool should be able to render the back
            panel, count and label connectors, route signals, and total power and
            heat load directly from the file. It is designed to be easy for
            manufacturers to produce (ideally auto-drafted from existing spec
            sheets, then human-reviewed) and easy for software vendors to consume
            (a stable core schema, strong validation, a typed SDK).
          </p>
          <p>
            Explicit non-goals for v1: modeling internal DSP/signal routing,
            being a pricing/availability catalog (ODIO links out instead),
            carrying real-time state, or replacing control protocols such as
            Dante, NDI, or Q-SYS — ODIO <em>references</em> them.
          </p>

          <h2 id="model">2. The data model</h2>
          <p>An ODIO document is a single JSON object with this top-level shape:</p>
          <CodeBlock language="device document">{`{
  "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
  "odioVersion": "0.1.0",        // format version (semver)
  "id": "extron/dtp2-t-211@a",   // stable, lowercase, URL-safe identifier
  "device":     { /* identity & classification */ },
  "ports":      [ /* the core: I/O ports */ ],
  "power":      { /* power inputs, consumption, heat */ },
  "physical":   { /* dimensions, weight, rack units, mounting */ },
  "standards":  [ /* compliance & interop standards */ ],
  "parameters": { /* free-form parametric data */ },
  "provenance": { /* where this data came from, validation status */ }
  // x-* keys permitted at any object level for vendor extensions
}`}</CodeBlock>
          <p>
            <code>manufacturer</code> and <code>model</code> are required. The{" "}
            <code>id</code> is derived as{" "}
            <code>slug(manufacturer)/slug(model)[@slug(revision)]</code> and is the
            join key tools and the registry use. The{" "}
            <Link href="/schema/v0.1/device.schema.json">JSON Schema</Link> is the
            single source of truth: the TypeScript SDK types are generated from it,
            and the normative prose is written to match it.
          </p>

          <h2 id="three-layer">3. The three-layer port model</h2>
          <p>
            A port is one externally accessible connector (or a group of identical
            ones). The model cleanly separates three concerns so that one physical
            connector can carry multiple concurrent logical flows:
          </p>
          <ul>
            <li>
              <strong>Connector</strong> — the physical jack only
              (<code>rj45</code>, <code>xlr-3-f</code>, <code>hdmi-type-a</code>,{" "}
              <code>phoenix</code>). The physical <code>poleCount</code> lives here.
            </li>
            <li>
              <strong>Link</strong> — the physical pipe the connector provides:
              the <code>type</code> (ethernet, usb, hdmi, fiber…), its{" "}
              <code>standard</code>/<code>speed</code>/<code>bandwidthGbps</code>,
              and link-level facts such as a PoE budget or USB Power Delivery
              wattage — stated once per port.
            </li>
            <li>
              <strong>Signals</strong> — one or more concurrent flows, each in a{" "}
              <code>domain</code> (<code>video</code>, <code>audio</code>,{" "}
              <code>control</code>, <code>network</code>, <code>data</code>,{" "}
              <code>power</code>) with a <code>transport</code> and
              domain-specific attributes.
            </li>
          </ul>
          <p>
            This is why one RJ45 can carry Dante + AES67 + general LAN at once, and
            why the physical pole count (<code>poleCount</code>) stays independent
            of the number of logical signal circuits (<code>signal.channels</code>)
            — the difference between a 3-pole Phoenix RS-232 port and an 8-pole
            Phoenix GPIO header.
          </p>

          <h2 id="bundles">4. Bundles &amp; cables</h2>
          <p>
            Many products are <strong>kits</strong>: one orderable part number that
            contains several devices, often with factory-terminated cables and
            mounting hardware. ODIO models these with two additional document kinds,
            discriminated by a top-level <code>kind</code> field (device documents
            have no <code>kind</code>):
          </p>
          <ul>
            <li>
              <strong>Bundle</strong> (<code>kind: &quot;bundle&quot;</code>) — a
              kit identity plus a <code>components[]</code> list. Each component is
              a device, a nested sub-assembly (another bundle), a cable, or a
              non-I/O accessory, inline or referenced by <code>id</code>. A design
              tool expands the kit into separate device blocks while billing them
              under one part number.
            </li>
            <li>
              <strong>Cable</strong> (<code>kind: &quot;cable&quot;</code>) — a
              first-class object with typed <code>ends</code> (each an ODIO
              connector + optional gender), the signals it <code>carries</code>
              (reusing the device signal model), <code>lengthMeters</code>, and a{" "}
              <code>factoryTerminated</code> flag. Cables are both BOM line items
              and the <em>edges</em> between devices on a schematic.
            </li>
          </ul>
          <p>
            The SDK&apos;s <code>flattenBundle()</code> expands a bundle&apos;s tree
            into leaf devices, cables, and accessories with effective quantities,
            and <code>bundleBillOfMaterials()</code> produces a flat BOM — exactly
            what the registry detail page renders for a kit.
          </p>

          <h2 id="provenance">5. Provenance &amp; trust</h2>
          <p>
            Provenance is what makes the format trustworthy. Every document records
            how it was produced (<code>generator</code>, <code>method</code>), the
            source documents it was derived from, and a validation status:
          </p>
          <ul>
            <li>
              <code>draft</code> — produced (often by the Genie importer) but not
              yet reviewed.
            </li>
            <li>
              <code>reviewed</code> — checked by a human against the source
              documents.
            </li>
            <li>
              <code>manufacturer-verified</code> — confirmed by the manufacturer;
              the highest-trust tier.
            </li>
          </ul>
          <p>
            Genie drafts also carry a <code>confidence</code> block listing
            low-confidence fields so a reviewer knows exactly what to check. A
            consumer can always tell a hand-keyed draft from a manufacturer-verified
            file.
          </p>

          <h2 id="extensibility">6. Extensibility &amp; versioning</h2>
          <p>
            ODIO is a <strong>closed core with an open edge</strong>. The core
            schema forbids unknown non-extension keys
            (<code>additionalProperties: false</code>) so drift is caught rather
            than silently accepted — but any object may carry keys matching{" "}
            <code>^x-</code> (e.g. <code>x-dtools</code>, <code>x-avcad</code>),
            which validators MUST ignore. Vendor-specific needs live under{" "}
            <code>x-</code> namespaces, never in the core.
          </p>
          <p>
            <code>odioVersion</code> is semver: MINOR releases add optional fields
            and grow the connector/standard/category vocabularies; MAJOR releases
            may change required fields or semantics. The <code>$schema</code> URL is
            versioned (<code>/schema/v0.1/…</code>), and an <code>other</code> +
            free-text escape hatch means a missing vocabulary term never blocks a
            valid file.
          </p>

          <h2 id="governance">7. Governance &amp; licensing</h2>
          <p>
            ODIO is an open standard governed in the open. Changes are proposed as
            short RFCs in pull requests, with semver discipline and a documented
            vocabulary-addition process. The format favors no single design tool;
            neutrality is a design constraint.
          </p>
          <ul>
            <li>
              <strong>Code &amp; JSON Schema:</strong> Apache-2.0, with an explicit
              patent grant — important for a standard that vendors build commercial
              products on.
            </li>
            <li>
              <strong>Specification &amp; documentation:</strong> Creative Commons
              Attribution 4.0 (CC BY 4.0) — vendors may quote and embed it.
            </li>
          </ul>
          <p>
            A file is <strong>conformant</strong> to ODIO 0.1 if and only if it
            validates, under JSON Schema draft 2020-12, against the schema for its
            kind. There are no conformance requirements beyond schema validation;
            the schema is authoritative.
          </p>

          <h2 id="roadmap">8. Roadmap</h2>
          <ul>
            <li>
              <strong>Canonical schema &amp; SDK (done).</strong> The device,
              bundle, and cable schemas; the <code>@opendeviceio/sdk</code>
              (generated types, an Ajv validator, and accessors); and adapters that
              expand ODIO into design-tool formats.
            </li>
            <li>
              <strong>This website &amp; registry (now).</strong> Canonical schema
              hosting at the versioned URLs, the whitepaper and authoring guide, and
              a free, searchable, downloadable registry of device, bundle, and cable
              files — which also resolves bundle references and settles the
              id-authority question.
            </li>
            <li>
              <strong>Corpus growth.</strong> Ingesting full manufacturer catalogs
              via the Genie pipeline with human review, prioritizing
              manufacturer-verified entries (highest trust and best training data).
            </li>
            <li>
              <strong>Hosted Genie (later, paid).</strong> A convenience import
              service (spec sheet → draft <code>.odio.json</code>). The spec, SDK,
              and CLI stay open; only the hosted convenience is monetized — never
              the standard.
            </li>
          </ul>

          <div className="mt-12 rounded-xl border border-slate-200 bg-slate-50 p-6">
            <p className="m-0 text-slate-700">
              Ready to publish a device? Read the{" "}
              <Link href="/guide">manufacturer authoring guide</Link>, browse the{" "}
              <Link href="/registry">registry</Link>, or fetch the canonical{" "}
              <a href="/schema/v0.1/device.schema.json">device schema</a>.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
