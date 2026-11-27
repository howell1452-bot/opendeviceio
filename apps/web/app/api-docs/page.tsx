import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";
import {
  ATTRIBUTION_TEXT,
  DATA_LICENSE,
  DATA_TERMS_PATH,
  LIST_MAX_LIMIT,
  LIST_MAX_LIMIT_WITH_DOCUMENTS,
  REMOVAL_WINDOW_DAYS,
  SYNC_INTERVAL_DAYS
} from "@/lib/data-license";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Reference for the free, read-only OpenDeviceIO REST API: list / search devices and fetch full .odio documents by id. CORS-enabled, no key required."
};

const TOC = [
  ["overview", "Overview"],
  ["list", "GET /api/v1/devices"],
  ["byid", "GET /api/v1/devices/{id}"],
  ["sync", "Export & sync"],
  ["removals", "GET /api/v1/removals"],
  ["cors", "CORS"],
  ["license", "License"],
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
      "updated_at": "2026-01-10T00:00:00.000Z",
      "registry_url": "https://opendeviceio.org/registry/lightware/ucx-4x2-hc60d",
      "api_url": "https://opendeviceio.org/api/v1/devices/lightware/ucx-4x2-hc60d"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "license": {
    "name": "${DATA_LICENSE.name}",
    "spdx": "${DATA_LICENSE.spdx}",
    "url": "${DATA_LICENSE.url}"
  },
  "terms_url": "https://opendeviceio.org${DATA_TERMS_PATH}",
  "attribution": "${ATTRIBUTION_TEXT}"
}`;

const SYNC_SNIPPET = `// Mirror the registry into your own catalog.
const BASE = "https://opendeviceio.org/api/v1";
const PAGE = ${LIST_MAX_LIMIT_WITH_DOCUMENTS};

// 1. Upsert everything changed since the last sync (or everything, first time).
async function syncChanges(since?: string) {
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(\`\${BASE}/devices\`);
    url.searchParams.set("include", "document");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("limit", String(PAGE));
    url.searchParams.set("offset", String(offset));
    // Optional: only checked data.
    // url.searchParams.set("status", "reviewed,manufacturer-verified");
    if (since) url.searchParams.set("updated_since", since);

    const page = await (await fetch(url)).json();
    for (const row of page.data) {
      await upsert(row.id, {
        document: row.document,
        status: row.validation_status,   // keep it; label drafts
        sourceLink: row.registry_url,    // attribution link
        updatedAt: row.updated_at
      });
    }
    if (offset + PAGE >= page.total) break;
    await new Promise((r) => setTimeout(r, 1000)); // be gentle
  }
}

// 2. Delete anything withdrawn since the last sync.
async function syncRemovals(since: string) {
  for (let offset = 0; ; offset += ${LIST_MAX_LIMIT}) {
    const url = new URL(\`\${BASE}/removals\`);
    url.searchParams.set("since", since);
    url.searchParams.set("limit", "${LIST_MAX_LIMIT}");
    url.searchParams.set("offset", String(offset));
    const page = await (await fetch(url)).json();
    for (const r of page.data) await remove(r.id);
    if (offset + ${LIST_MAX_LIMIT} >= page.total) break;
  }
}

// Record the time BEFORE you start, and use it as "since" next run.`;

const REMOVALS_RESPONSE = `{
  "data": [
    {
      "id": "acme/dsp-1212@1",
      "kind": "device",
      "manufacturer": "Acme",
      "removed_at": "2026-11-20T14:03:11.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "removal_window_days": ${REMOVAL_WINDOW_DAYS},
  "license": { "...": "..." },
  "terms_url": "https://opendeviceio.org${DATA_TERMS_PATH}",
  "attribution": "${ATTRIBUTION_TEXT}"
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
            A free REST API over the OpenDeviceIO registry. Reading needs no
            key and no auth, and it&apos;s CORS-enabled, so you can call it from a
            browser plugin or a backend. Registry data is licensed{" "}
            <Link href={DATA_TERMS_PATH}>{DATA_LICENSE.short}</Link>.
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
              <strong>Auth:</strong> none for reads. Publishing (
              <code>POST /api/v1/devices</code>) needs a verified
              manufacturer&apos;s API token.
            </li>
            <li>
              <strong>License:</strong>{" "}
              <Link href={DATA_TERMS_PATH}>{DATA_LICENSE.short}</Link>, with
              attribution.
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
                <Row name="status" type="string">
                  Comma-separated validation statuses:{" "}
                  <code>draft</code>, <code>reviewed</code>,{" "}
                  <code>manufacturer-verified</code>. E.g.{" "}
                  <code>status=reviewed,manufacturer-verified</code>.
                </Row>
                <Row name="updated_since" type="ISO 8601">
                  Only entries whose <code>updated_at</code> is at or after this
                  time. For incremental sync.
                </Row>
                <Row name="sort" type="string">
                  <code>name</code> (default: manufacturer, model, id) or{" "}
                  <code>updated</code> (updated_at, id). Use{" "}
                  <code>updated</code> when syncing.
                </Row>
                <Row name="include" type="string">
                  <code>document</code> embeds the full <code>.odio</code>{" "}
                  document in each row. This is the bulk export method.
                </Row>
                <Row name="limit" type="integer">
                  Page size. Default <code>50</code>, max{" "}
                  <code>{LIST_MAX_LIMIT}</code> (
                  <code>{LIST_MAX_LIMIT_WITH_DOCUMENTS}</code> with{" "}
                  <code>include=document</code>).
                </Row>
                <Row name="offset" type="integer">
                  Row offset for pagination. Default <code>0</code>.
                </Row>
              </tbody>
            </table>
          </div>
          <p>
            Returns <code>{`{ data, total, limit, offset }`}</code> plus{" "}
            <code>license</code>, <code>terms_url</code>, and{" "}
            <code>attribution</code>. <code>data</code> is an array of list
            rows: the document metadata, without the heavy{" "}
            <code>document</code> body unless you pass{" "}
            <code>include=document</code>. Each row also has a{" "}
            <code>registry_url</code> (the human-readable source link to use
            for attribution) and an <code>api_url</code>. <code>total</code> is
            the unpaginated match count. Ordering always ends on{" "}
            <code>id</code>, so offset paging is stable. Invalid{" "}
            <code>status</code>, <code>updated_since</code>, <code>sort</code>
            , or <code>include</code> values return <code>400</code>.
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

          {/* Sync */}
          <h2 id="sync">Export &amp; sync</h2>
          <p>
            To keep a copy of the registry in your own catalog, page through{" "}
            <code>GET /api/v1/devices?include=document&amp;sort=updated</code>{" "}
            once for a full export. After that, sync incrementally with{" "}
            <code>updated_since</code> and apply removals from{" "}
            <code>GET /api/v1/removals</code>. Upsert by <code>id</code>; ids
            are stable. A full export of a few thousand records is a few dozen
            requests.
          </p>
          <CodeBlock language="typescript">{SYNC_SNIPPET}</CodeBlock>
          <p>
            Products that mirror the registry should refresh at least every{" "}
            {SYNC_INTERVAL_DAYS} days and apply removals within{" "}
            {REMOVAL_WINDOW_DAYS} days. See the{" "}
            <Link href={`${DATA_TERMS_PATH}#integrations`}>
              integration terms
            </Link>
            , and{" "}
            <Link href="/implement/register">register your integration</Link>{" "}
            to get removal and change notices by email.
          </p>

          {/* Removals */}
          <h2 id="removals">
            <Method>get</Method>{" "}
            <code className="text-base">/api/v1/removals</code>
          </h2>
          <p>
            The removal feed lists ids that were deleted from the registry or
            renamed out of it, oldest first. If an id is published again later,
            it drops out of this feed and reappears in{" "}
            <code>updated_since</code> results.
          </p>
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
                <Row name="since" type="ISO 8601">
                  Only removals at or after this time. Omit it to get the full
                  history.
                </Row>
                <Row name="limit" type="integer">
                  Page size. Default <code>50</code>, max{" "}
                  <code>{LIST_MAX_LIMIT}</code>.
                </Row>
                <Row name="offset" type="integer">
                  Row offset. Default <code>0</code>.
                </Row>
              </tbody>
            </table>
          </div>
          <p className="mb-1 font-semibold text-slate-800">Example response</p>
          <CodeBlock language="json">{REMOVALS_RESPONSE}</CodeBlock>

          {/* CORS */}
          <h2 id="cors">CORS</h2>
          <p>
            Every read endpoint sends{" "}
            <code>Access-Control-Allow-Origin: *</code>, allows{" "}
            <code>GET</code> and <code>OPTIONS</code>, and answers CORS
            preflight (<code>OPTIONS</code>) requests. You can call the API
            directly from browser-based tools and plugins without a proxy.
          </p>

          {/* License */}
          <h2 id="license">License</h2>
          <p>
            Registry records are licensed{" "}
            <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a>. You may store,
            normalize, and display them, including in commercial products, with
            attribution. Every response carries a{" "}
            <code>Link: &lt;…&gt;; rel=&quot;license&quot;</code> header, and
            list responses carry <code>license</code> and{" "}
            <code>attribution</code> fields. Keep <code>validation_status</code>{" "}
            with each record and label drafts. The registry contains no product
            images. Full terms are on the{" "}
            <Link href={DATA_TERMS_PATH}>data license page</Link>.
          </p>

          {/* Usage */}
          <h2 id="usage">Usage &amp; limits</h2>
          <p>
            Reading is <strong>free</strong> and needs no API key. No hard rate
            limit is enforced today. Please keep to roughly one request per
            second, run bulk syncs no more than daily, and cache responses
            rather than re-fetching on every render, since documents change
            infrequently. Responses are served fresh (
            <code>Cache-Control: no-store</code>) so you always get current
            data. We may add keys or limits for heavy use, and{" "}
            <Link href="/implement/register">registered integrations</Link>{" "}
            get advance notice.
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
