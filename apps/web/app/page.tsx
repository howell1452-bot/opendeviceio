import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

const EXAMPLE = `{
  "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
  "odioVersion": "0.1.0",
  "id": "extron/dtp2-t-211@a",
  "device": { "manufacturer": "Extron", "model": "DTP2 T 211" },
  "ports": [
    {
      "id": "hdmi-in-1", "label": "HDMI INPUT 1", "direction": "input",
      "connector": "hdmi-type-a",
      "link": { "type": "hdmi", "standard": "hdmi-2.0", "bandwidthGbps": 18 },
      "signals": [
        { "domain": "video", "transport": "hdmi", "maxResolution": "4096x2160" },
        { "domain": "audio", "transport": "lpcm", "maxChannelsPerCircuit": 8 }
      ]
    }
  ]
}`;

function CardLink({
  href,
  title,
  children,
  external
}: {
  href: string;
  title: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls =
    "group block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md";
  const body = (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <span className="text-brand-500 transition group-hover:translate-x-0.5">→</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{children}</p>
    </>
  );
  return external ? (
    <a className={cls} href={href}>
      {body}
    </a>
  ) : (
    <Link className={cls} href={href}>
      {body}
    </Link>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
              Open standard · v0.1.0
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              One file describes a device&apos;s I/O — so design tools never
              re-key a spec sheet again.
            </h1>
            <p className="mt-6 text-lg text-slate-600">
              OpenDeviceIO (ODIO) is an open, machine-readable format for a
              hardware device&apos;s connectors, signals, power, physical
              characteristics, and compliance. Manufacturers publish an{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                .odio.json
              </code>{" "}
              alongside their support documents; AV/IT design software imports it
              to render back panels, route signals, and total power and heat load.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/registry"
                className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-brand-700"
              >
                Browse the registry
              </Link>
              <Link
                href="/guide"
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Author a file
              </Link>
              <Link
                href="/whitepaper"
                className="rounded-lg px-5 py-2.5 font-medium text-slate-600 transition hover:text-slate-900"
              >
                Read the whitepaper →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">The problem</h2>
            <p className="mt-4 text-slate-600">
              AV and control-systems designers — and the CAD tools they use
              (AVCAD, D-Tools, XTEN-AV, Stardraw, and others) — have no universal,
              machine-readable source of truth for a device&apos;s connectors,
              signals, power, and control. That data lives in PDF spec sheets and
              gets re-keyed by hand into every tool&apos;s product database, with
              errors.
            </p>
            <p className="mt-4 text-slate-600">
              ODIO defines a single file a manufacturer can publish alongside a
              product&apos;s support documents, describing the device&apos;s
              externally observable I/O accurately enough to draw with.
            </p>
          </div>
          <div>
            <CodeBlock language="extron/dtp2-t-211@a · device">{EXAMPLE}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Three-layer model */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold text-slate-900">
            The three-layer port model
          </h2>
          <p className="mt-3 max-w-3xl text-slate-600">
            A device&apos;s <strong>ports</strong> are the heart of the format.
            Each port cleanly separates three concerns, so one connector can carry
            many concurrent flows (one RJ45 carrying Dante + AES67 + general LAN),
            and physical pole count stays separate from the number of independent
            signal circuits.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              {
                n: "1",
                t: "Connector",
                d: "The physical jack only — rj45, xlr-3-f, 3.5mm-trs, hdmi-type-a, phoenix. Pole count lives here."
              },
              {
                n: "2",
                t: "Link",
                d: "The physical pipe the connector provides: 1 GbE with 802.3at PoE, USB with a 60 W PD budget, single-mode fiber. Link-level facts once per port."
              },
              {
                n: "3",
                t: "Signals",
                d: "One or more concurrent logical flows, each in its domain — video, audio, control, network, data, power."
              }
            ].map((c) => (
              <div
                key={c.n}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 font-mono text-sm font-bold text-white">
                  {c.n}
                </div>
                <h3 className="mt-3 font-semibold text-slate-900">{c.t}</h3>
                <p className="mt-2 text-sm text-slate-600">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For tool builders */}
      <section className="border-b border-slate-200 bg-brand-600">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-white">
              Build an ODIO importer for your tool
            </h2>
            <p className="mt-3 text-brand-50">
              EasySchematic, XTEN-AV, AVCAD, D-Tools, Visio — consume ODIO with
              the SDK or the free, read-only public API, and map devices into
              your own port model with the proven primary-signal recipe.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/implement"
              className="rounded-lg bg-white px-5 py-2.5 font-medium text-brand-700 shadow-sm transition hover:bg-brand-50"
            >
              Implement ODIO
            </Link>
            <Link
              href="/api-docs"
              className="rounded-lg border border-white/40 px-5 py-2.5 font-medium text-white transition hover:bg-white/10"
            >
              API reference →
            </Link>
          </div>
        </div>
      </section>

      {/* Quick links */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900">Explore</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <CardLink href="/whitepaper" title="Whitepaper">
            Motivation, the data model, bundles &amp; cables, governance and
            licensing, and the roadmap.
          </CardLink>
          <CardLink href="/guide" title="Authoring guide">
            Produce a conformant <code>.odio.json</code> by hand, with the SDK, or
            via the Genie importer — and how to validate it.
          </CardLink>
          <CardLink href="/registry" title="Device registry">
            A searchable, freely downloadable library of device, bundle, and cable
            files.
          </CardLink>
          <CardLink href="/schema/v0.1/device.schema.json" title="Device schema" external>
            The canonical JSON Schema for a device document (v0.1).
          </CardLink>
          <CardLink href="/schema/v0.1/bundle.schema.json" title="Bundle schema" external>
            Kits / assemblies: a part number containing devices, sub-assemblies,
            and cables.
          </CardLink>
          <CardLink href="/schema/v0.1/cable.schema.json" title="Cable schema" external>
            First-class cables: typed ends, the signals they carry, length and
            termination.
          </CardLink>
        </div>
      </section>
    </>
  );
}
