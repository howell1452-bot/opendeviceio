import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "For design software vendors",
  description:
    "A practical guide for AV / CAD / schematic tool vendors (EasySchematic, XTEN-AV, AVCAD, D-Tools, Visio, …) to consume OpenDeviceIO: the connector/link/signals model, the SDK, the public API, and the primary-signal mapping recipe used by the reference EasySchematic adapter."
};

const TOC = [
  ["what", "What ODIO is"],
  ["consume", "Consuming ODIO"],
  ["mapping", "Mapping recipe"],
  ["reference", "Reference implementation"],
  ["snippets", "Code snippets"],
  ["api", "The public API"],
  ["schemas", "Schemas & licensing"]
] as const;

const FETCH_SNIPPET = `// Fetch a single ODIO document from the free, read-only public API.
// ids contain slashes, e.g. "lightware/ucx-4x2-hc60d".
async function fetchDevice(id: string) {
  const res = await fetch(\`https://opendeviceio.org/api/v1/devices/\${id}\`);
  if (res.status === 404) return null;        // unknown id
  if (!res.ok) throw new Error(\`ODIO API \${res.status}\`);
  return res.json();                          // the full ODIO document
}

// Search / list (paged): returns { data, total, limit, offset }.
async function searchDevices(q: string) {
  const url = new URL("https://opendeviceio.org/api/v1/devices");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "50");
  const res = await fetch(url);
  return res.json();
}`;

const VALIDATE_SNIPPET = `import { parseDocument, validateDocument } from "@opendeviceio/sdk";

const doc = await fetchDevice("lightware/ucx-4x2-hc60d");

// Validate before trusting it. validateDocument detects the kind from $schema.
const result = validateDocument(doc);
if (!result.valid) {
  console.error(result.errors);
  throw new Error("Document failed ODIO validation");
}

// Or parse-and-throw, returning a typed value:
const device = parseDocument(doc); // OdioDevice | Bundle | Cable`;

const COLLAPSE_SNIPPET = `import type { OdioDevice, Port, Signal } from "@opendeviceio/sdk";

// Most schematic/CAD tools model ONE signal per port. ODIO ports can carry
// several concurrent signals (one HDMI port = video + audio; one RJ45 =
// Dante + AES67 + LAN). To map an ODIO device into a one-signal-per-port
// tool, collapse each connector to a single port and pick a PRIMARY signal
// by domain priority, keeping the rest as notes.

const DOMAIN_PRIORITY = [
  "video",
  "audio",
  "control",
  "network",
  "data",
  "power"
] as const;

function primarySignal(port: Port): Signal | undefined {
  const signals = port.signals ?? [];
  if (signals.length <= 1) return signals[0];
  // Lower index in DOMAIN_PRIORITY wins; unknown domains sort last.
  return [...signals].sort((a, b) => {
    const ia = DOMAIN_PRIORITY.indexOf(a.domain as never);
    const ib = DOMAIN_PRIORITY.indexOf(b.domain as never);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  })[0];
}

interface ToolPort {
  id: string;
  label: string;
  direction: "input" | "output" | string;
  connector: string;
  primaryDomain?: string;
  notes: string[]; // the signals we did NOT promote, for the human
}

function toToolPort(port: Port): ToolPort {
  const primary = primarySignal(port);
  const others = (port.signals ?? []).filter((s) => s !== primary);
  return {
    id: port.id,
    label: port.label ?? port.id,
    direction: port.direction,
    connector: port.connector,
    primaryDomain: primary?.domain,
    notes: others.map(
      (s) => \`also carries \${s.domain} (\${s.transport ?? "n/a"})\`
    )
  };
}

// One ODIO port -> exactly one tool port. This is what the reference
// EasySchematic adapter does (one ES port per connector).
function deviceToToolPorts(device: OdioDevice): ToolPort[] {
  return (device.ports ?? []).map(toToolPort);
}`;

export default function ImplementPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              On this page
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
            <div className="mt-6 border-t border-slate-200 pt-4 text-sm">
              <Link
                href="/api-docs"
                className="font-medium text-brand-700 hover:text-brand-800"
              >
                API reference →
              </Link>
            </div>
          </div>
        </aside>

        <article className="prose-odio max-w-none">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
            For design software vendors
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Implement ODIO in your tool
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            A practical guide for AV, CAD, and schematic software vendors —
            EasySchematic, XTEN-AV, AVCAD, D-Tools, Visio, Stardraw, and the
            like — to consume OpenDeviceIO so your users import accurate device
            data instead of re-keying PDF spec sheets. You can pull data from the{" "}
            <Link href="/api-docs">free, read-only public API</Link> or read{" "}
            <code>.odio</code> files directly with the SDK.
          </p>

          <div className="my-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="m-0 font-semibold text-emerald-900">
              Are you a manufacturer?
            </p>
            <p className="mb-0 mt-2 text-emerald-900">
              Brands can publish authoritative, <strong>manufacturer-verified</strong>{" "}
              files for their own products. Approved reps upload{" "}
              <code>.odio</code> files through the web UI or an authenticated{" "}
              <code>POST /api/v1/devices</code> token.{" "}
              <Link href="/contribute" className="font-semibold underline">
                Request access on the Contribute page →
              </Link>
            </p>
          </div>

          {/* What ODIO is */}
          <h2 id="what">What ODIO is</h2>
          <p>
            ODIO (OpenDeviceIO) is an open, machine-readable format describing a
            hardware device&apos;s externally observable I/O, power, physical,
            and compliance characteristics. The heart of the format is the{" "}
            <strong>port</strong>, and each port separates three concerns — the{" "}
            <strong>connector → link → signals</strong> model:
          </p>
          <ol>
            <li>
              <strong>Connector</strong> — the physical jack only:{" "}
              <code>rj45</code>, <code>xlr-3-f</code>, <code>hdmi-type-a</code>,{" "}
              <code>phoenix</code>. Pole count lives here.
            </li>
            <li>
              <strong>Link</strong> — the physical pipe that connector provides:
              1&nbsp;GbE with 802.3at PoE, USB with a 60&nbsp;W PD budget,
              single-mode fiber. Stated once per port.
            </li>
            <li>
              <strong>Signals</strong> — one or more <em>concurrent</em> logical
              flows, each in its domain: <code>video</code>, <code>audio</code>,{" "}
              <code>control</code>, <code>network</code>, <code>data</code>,{" "}
              <code>power</code>. One HDMI port carries video + audio; one RJ45
              can carry Dante + AES67 + general LAN.
            </li>
          </ol>
          <p>
            A document&apos;s <code>kind</code> is one of <strong>device</strong>
            , <strong>bundle</strong> (a kit / assembly — a part number that
            contains devices, sub-assemblies, and cables), or{" "}
            <strong>cable</strong> (a first-class cable with typed ends). See the{" "}
            <Link href="/whitepaper">whitepaper</Link> for the full data model.
          </p>

          {/* Consuming ODIO */}
          <h2 id="consume">Consuming ODIO</h2>
          <p>There are two ways to get ODIO data into your tool:</p>
          <h3>1. The TypeScript SDK</h3>
          <p>
            Install the SDK and read <code>.odio</code> files (whether you
            fetched them, bundled them, or accepted them as an import):
          </p>
          <CodeBlock language="shell">npm install @opendeviceio/sdk</CodeBlock>
          <p>The SDK gives you:</p>
          <ul>
            <li>
              <code>validateDocument(doc)</code> /{" "}
              <code>validateBundle</code> / <code>validateCable</code> —
              schema validation; returns <code>{`{ valid, errors }`}</code>.
            </li>
            <li>
              <code>parseDocument(doc)</code> / <code>parse</code> — validate
              and return a typed value, throwing on failure.
            </li>
            <li>
              <code>flattenBundle(bundle)</code> — expand a kit into its
              constituent devices plus cable / accessory line items (the bill of
              materials). Use this when a bundle should render as several device
              blocks with cable accessories between them.
            </li>
            <li>
              Accessors such as <code>inputPorts</code>, <code>outputPorts</code>
              , <code>portsByConnector</code>, <code>signalsByDomain</code>,{" "}
              <code>totalMaxWatts</code>, <code>poeBudget</code>, and{" "}
              <code>rackUnits</code> for derived facts.
            </li>
          </ul>
          <h3>2. The public REST API</h3>
          <p>
            If you would rather not bundle the SDK, fetch JSON straight from the{" "}
            <Link href="/api-docs">public API</Link>. It is free, read-only, and
            CORS-enabled, so you can call it from a browser plugin or a backend.
            Validate the response with the SDK if you want strong typing; the
            data already validated before it entered the registry.
          </p>

          {/* Mapping recipe */}
          <h2 id="mapping">Mapping recipe: ODIO ports → your port model</h2>
          <p>
            ODIO models a port as <em>one connector that can carry several
            concurrent signals</em>. Most schematic and CAD tools model the
            opposite: <strong>one signal per port</strong>. This mismatch is the
            single most important thing to get right.
          </p>
          <div className="my-6 rounded-xl border border-brand-200 bg-brand-50 p-5">
            <p className="m-0 font-semibold text-brand-900">The key lesson</p>
            <p className="mb-0 mt-2 text-brand-900">
              If your tool models one signal per port (most do),{" "}
              <strong>collapse each multi-signal connector down to ONE port</strong>{" "}
              and pick a <strong>primary signal</strong> by domain priority:
            </p>
            <p className="mb-0 mt-3 font-mono text-sm text-brand-900">
              video &gt; audio &gt; control &gt; network &gt; data &gt; power
            </p>
            <p className="mb-0 mt-3 text-brand-900">
              Keep the signals you did <em>not</em> promote as notes on that
              port, so nothing is silently dropped. An HDMI port (video + audio)
              becomes one port whose primary domain is <code>video</code>, with
              &ldquo;also carries audio&rdquo; recorded as a note.
            </p>
          </div>
          <p>
            This is exactly what the reference{" "}
            <strong>EasySchematic adapter</strong> does: it emits{" "}
            <strong>one ES port per ODIO connector</strong>, choosing the primary
            signal by that priority order. The collapse keeps the drawn back
            panel faithful (one jack = one port) while preserving the richer
            multi-signal truth as annotations.
          </p>
          <p>
            For <strong>bundles</strong>, run <code>flattenBundle</code> first:
            each contained device becomes its own device block, and the cables /
            accessories become cable accessories or line items between them. Do
            not try to draw a bundle as a single device.
          </p>

          {/* Reference implementation */}
          <h2 id="reference">Reference implementation: copy the adapter</h2>
          <p>
            Rather than write the mapping from scratch, start from the reference
            adapter package{" "}
            <code>@opendeviceio/adapters</code> — it contains the EasySchematic
            exporter, which implements the connector-to-port collapse and
            primary-signal selection described above. Copy its approach (and, if
            your stack is TypeScript, much of its code) and adjust the output
            shape to your tool&apos;s own port / device model.
          </p>

          {/* Snippets */}
          <h2 id="snippets">Code snippets</h2>
          <p>Fetch a device from the public API:</p>
          <CodeBlock language="typescript">{FETCH_SNIPPET}</CodeBlock>
          <p>Validate it with the SDK before trusting it:</p>
          <CodeBlock language="typescript">{VALIDATE_SNIPPET}</CodeBlock>
          <p>
            The primary-signal collapse — one ODIO port to one tool port — the
            same logic the EasySchematic adapter uses:
          </p>
          <CodeBlock language="typescript">{COLLAPSE_SNIPPET}</CodeBlock>

          {/* API */}
          <h2 id="api">The public API</h2>
          <p>
            Two endpoints, both CORS-enabled and free to use without a key. Full
            parameter and response documentation is on the{" "}
            <Link href="/api-docs">API reference</Link> page.
          </p>
          <ul>
            <li>
              <code>GET /api/v1/devices</code> — list / search the registry
              (paged).
            </li>
            <li>
              <code>GET /api/v1/devices/&#123;id&#125;</code> — fetch the full
              ODIO document by id (ids contain slashes).
            </li>
          </ul>

          {/* Schemas */}
          <h2 id="schemas">Schemas &amp; licensing</h2>
          <p>
            The canonical JSON Schemas are hosted with permissive CORS at{" "}
            <code>https://opendeviceio.org/schema/v0.1/*.schema.json</code> —{" "}
            <a href="/schema/v0.1/device.schema.json">device</a>,{" "}
            <a href="/schema/v0.1/bundle.schema.json">bundle</a>, and{" "}
            <a href="/schema/v0.1/cable.schema.json">cable</a>. Every document
            references its schema via <code>$schema</code>, so{" "}
            <code>$ref</code> resolution works from any validator.
          </p>
          <p>
            The registry data is free and read-only. The schema and SDK are
            Apache-2.0; the spec and docs are CC&nbsp;BY&nbsp;4.0. You are free
            to ship an ODIO importer in a commercial product.
          </p>
        </article>
      </div>
    </div>
  );
}
