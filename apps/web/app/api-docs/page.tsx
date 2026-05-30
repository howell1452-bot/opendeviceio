import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Reference for the free, read-only OpenDeviceIO REST API: list / search devices and fetch full .odio documents by id. CORS-enabled, no key required."
};

const TOC = [
  ["overview", "Overview"],
  ["list", "GET /api/v1/devices"],
  ["byid", "GET /api/v1/devices/{id}"],
  ["cors", "CORS"],
  ["usage", "Usage & limits"]
] as const;

const LIST_CURL = `curl "https://opendeviceio.org/api/v1/devices?q=lightware&kind=device&limit=20"`;

const LIST_FETCH = `const url = new URL("https://opendeviceio.org/api/v1/devices");
url.searchParams.set("q", "lightware");
url.searchParams.set("kind", "device");
url.searchParams.set("limit", "20");
url.searchParams.set("offset", "0");

const res = await fetch(url);
const { data, total, limit, offset } = await res.json();`;

const LIST_RESPONSE = `{
  "data": [
    {
      "id": "lightware/ucx-4x2-hc60d",
      "kind": "device",
      "manufacturer": "Lightware",
      "model": "UCX-4x2-HC60D",
      "category": "matrix-switcher",
      "product_line": "Taurus",
      "sku": "91840012",
      "validation_status": "reviewed",
      "odio_version": "0.1.0",
      "port_count": 12,
      "connectors": ["hdmi-type-a", "usb-c", "rj45"],
      "transports": ["hdmi", "usb", "ethernet"],
      "created_at": "2026-01-10T00:00:00.000Z",
      "updated_at": "2026-01-10T00:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}`;

const BYID_CURL = `curl "https://opendeviceio.org/api/v1/devices/lightware/ucx-4x2-hc60d"`;

const BYID_FETCH = `// ids contain slashes — don't URL-encode the slashes between segments.
const id = "lightware/ucx-4x2-hc60d";
const res = await fetch(\`https://opendeviceio.org/api/v1/devices/\${id}\`);
if (res.status === 404) {
  // unknown id
} else {
  const document = await res.json(); // the full .odio document
}`;

const BYID_RESPONSE = `{
  "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
  "odioVersion": "0.1.0",
  "id": "lightware/ucx-4x2-hc60d",
  "device": { "manufacturer": "Lightware", "model": "UCX-4x2-HC60D" },
  "ports": [
    {
      "id": "hdmi-in-1",
      "label": "HDMI INPUT 1",
      "direction": "input",
      "connector": "hdmi-type-a",
      "link": { "type": "hdmi", "standard": "hdmi-2.0", "bandwidthGbps": 18 },
      "signals": [
        { "domain": "video", "transport": "hdmi", "maxResolution": "4096x2160" },
        { "domain": "audio", "transport": "lpcm", "maxChannelsPerCircuit": 8 }
      ]
    }
  ]
}`;

const NOT_FOUND = `{ "error": "not found" }`;

function Method({ children }: { children: string }) {
  return (
    <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 font-mono text-xs font-bold uppercase text-emerald-800 ring-1 ring-inset ring-emerald-200">
      {children}
    </span>
  );
}

function Row({
  name,
  type,
  children
}: {
  name: string;
  type: string;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-4 font-mono text-sm text-slate-900">{name}</td>
      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{type}</td>
      <td className="py-2 text-sm text-slate-600">{children}</td>
    </tr>
  );
}

export default function ApiDocsPage() {
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
                  className="block font-mono text-slate-600 hover:text-brand-700"
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="mt-6 border-t border-slate-200 pt-4 text-sm">
              <Link
                href="/implement"
                className="font-medium text-brand-700 hover:text-brand-800"
              >
                ← Implementation guide
              </Link>
            </div>
          </div>
        </aside>

        <article className="prose-odio max-w-none">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
            For tool builders
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            API reference
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            A free, read-only REST API over the OpenDeviceIO registry. No key,
            no auth, CORS-enabled — call it from a browser plugin or a backend.
            For how to map the data into your tool, see the{" "}
            <Link href="/implement">implementation guide</Link>.
          </p>

          {/* Overview */}
          <h2 id="overview">Overview</h2>
          <ul>
            <li>
              <strong>Base URL:</strong>{" "}
              <code>https://opendeviceio.org/api/v1</code>
            </li>
            <li>
              <strong>Auth:</strong> none.
            </li>
            <li>
              <strong>Methods:</strong> <code>GET</code> and{" "}
              <code>OPTIONS</code> only.
            </li>
            <li>
              <strong>Format:</strong> JSON (<code>application/json</code>).
            </li>
          </ul>

          {/* List */}
          <h2 id="list">
            <Method>get</Method>{" "}
            <code className="text-base">/api/v1/devices</code>
          </h2>
          <p>List and search the registry. All parameters are optional.</p>
          <div className="not-prose my-4 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-semibold">Param</th>
                  <th className="py-2 pr-4 font-semibold">Type</th>
                  <th className="py-2 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                <Row name="q" type="string">
                  Case-insensitive text search over manufacturer, model, and id.
                </Row>
                <Row name="manufacturer" type="string">
                  Exact manufacturer match.
                </Row>
                <Row name="category" type="string">
                  Exact category match (e.g. <code>matrix-switcher</code>).
                </Row>
                <Row name="kind" type="string">
                  One of <code>device</code>, <code>bundle</code>,{" "}
                  <code>cable</code>.
                </Row>
                <Row name="connector" type="string">
                  Entries that have this connector (e.g. <code>rj45</code>).
                </Row>
                <Row name="transport" type="string">
                  Entries that carry this transport (e.g. <code>hdmi</code>).
                </Row>
                <Row name="limit" type="integer">
                  Page size. Default <code>50</code>, max <code>200</code>.
                </Row>
                <Row name="offset" type="integer">
                  Row offset for pagination. Default <code>0</code>.
                </Row>
              </tbody>
            </table>
          </div>
          <p>
            Returns <code>{`{ data, total, limit, offset }`}</code>, where{" "}
            <code>data</code> is an array of list rows (the document metadata,
            without the heavy <code>document</code> body) and <code>total</code>{" "}
            is the unpaginated match count.
          </p>
          <p className="mb-1 font-semibold text-slate-800">curl</p>
          <CodeBlock language="shell">{LIST_CURL}</CodeBlock>
          <p className="mb-1 font-semibold text-slate-800">fetch</p>
          <CodeBlock language="typescript">{LIST_FETCH}</CodeBlock>
          <p className="mb-1 font-semibold text-slate-800">Example response</p>
          <CodeBlock language="json">{LIST_RESPONSE}</CodeBlock>

          {/* By id */}
          <h2 id="byid">
            <Method>get</Method>{" "}
            <code className="text-base">/api/v1/devices/&#123;id&#125;</code>
          </h2>
          <p>
            Fetch the full ODIO document for one entry. The id is a catch-all
            path segment, so it carries the slash inside an id verbatim — e.g.{" "}
            <code>/api/v1/devices/lightware/ucx-4x2-hc60d</code>. Returns the raw{" "}
            <code>.odio</code> document (device, bundle, or cable). A{" "}
            missing id returns <code>404</code> with{" "}
            <code>{`{ "error": "not found" }`}</code>.
          </p>
          <p className="mb-1 font-semibold text-slate-800">curl</p>
          <CodeBlock language="shell">{BYID_CURL}</CodeBlock>
          <p className="mb-1 font-semibold text-slate-800">fetch</p>
          <CodeBlock language="typescript">{BYID_FETCH}</CodeBlock>
          <p className="mb-1 font-semibold text-slate-800">
            Example response (200)
          </p>
          <CodeBlock language="json">{BYID_RESPONSE}</CodeBlock>
          <p className="mb-1 font-semibold text-slate-800">Not found (404)</p>
          <CodeBlock language="json">{NOT_FOUND}</CodeBlock>

          {/* CORS */}
          <h2 id="cors">CORS</h2>
          <p>
            Both endpoints send{" "}
            <code>Access-Control-Allow-Origin: *</code> and{" "}
            <code>Access-Control-Allow-Methods: GET, OPTIONS</code>, and answer
            CORS preflight (<code>OPTIONS</code>) requests. You can call the API
            directly from browser-based tools and plugins without a proxy.
          </p>

          {/* Usage */}
          <h2 id="usage">Usage &amp; limits</h2>
          <p>
            The API is <strong>free</strong> and <strong>read-only</strong> —
            there is no write endpoint and no API key. Please cache responses
            where reasonable rather than re-fetching on every render; documents
            change infrequently. Responses are served fresh (
            <code>Cache-Control: no-store</code>) so you always get current data.
          </p>
          <p>
            Want strong typing on the client? Validate responses with{" "}
            <code>@opendeviceio/sdk</code> — see the{" "}
            <Link href="/implement">implementation guide</Link>.
          </p>
        </article>
      </div>
    </div>
  );
}
