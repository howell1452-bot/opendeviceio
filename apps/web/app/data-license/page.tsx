import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";
import {
  ATTRIBUTION_TEXT,
  DATA_LICENSE,
  DATA_TERMS_VERSION,
  LIST_MAX_LIMIT,
  LIST_MAX_LIMIT_WITH_DOCUMENTS,
  REMOVAL_REQUEST_BUSINESS_DAYS,
  REMOVAL_WINDOW_DAYS,
  SYNC_INTERVAL_DAYS
} from "@/lib/data-license";

export const metadata: Metadata = {
  title: "Registry data license & integration terms",
  description: `OpenDeviceIO registry records are licensed ${DATA_LICENSE.short}: store, normalize, and display them — including in commercial products — with attribution. Plus validation-status labeling, images, sync, and removal terms for integrations.`
};

const TOC = [
  ["summary", "Summary"],
  ["scope", "What this covers"],
  ["license", "The license"],
  ["attribution", "Attribution"],
  ["status", "Validation status"],
  ["images", "Images & trademarks"],
  ["sync", "Export, sync & limits"],
  ["integrations", "Integration terms"],
  ["removals", "Corrections & removals"],
  ["warranty", "No warranty"],
  ["changes", "Changes"]
] as const;

const EXPORT_SNIPPET = `# Full export: page through every record with its full document.
GET /api/v1/devices?include=document&sort=updated&limit=${LIST_MAX_LIMIT_WITH_DOCUMENTS}&offset=0
GET /api/v1/devices?include=document&sort=updated&limit=${LIST_MAX_LIMIT_WITH_DOCUMENTS}&offset=${LIST_MAX_LIMIT_WITH_DOCUMENTS}
...                                  # until offset >= total

# Only reviewed and manufacturer-verified records:
GET /api/v1/devices?include=document&status=reviewed,manufacturer-verified

# Incremental: what changed since your last sync (upsert by id) ...
GET /api/v1/devices?include=document&sort=updated&updated_since=2026-11-01T00:00:00Z

# ... and what was withdrawn (delete by id).
GET /api/v1/removals?since=2026-11-01T00:00:00Z`;

export default function DataLicensePage() {
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
                href="/implement/register"
                className="font-medium text-brand-700 hover:text-brand-800"
              >
                Register an integration →
              </Link>
            </div>
          </div>
        </aside>

        <article className="prose-odio max-w-none">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
            Registry data
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Data license &amp; integration terms
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Version {DATA_TERMS_VERSION}
          </p>

          <div
            id="summary"
            className="my-6 scroll-mt-24 rounded-xl border border-emerald-200 bg-emerald-50 p-5"
          >
            <p className="m-0 font-semibold text-emerald-900">Summary</p>
            <ul className="mb-0 mt-3 text-emerald-900">
              <li>
                Registry records are licensed{" "}
                <a href={DATA_LICENSE.url}>{DATA_LICENSE.short}</a>. You may
                store, normalize, and display them — including to signed-in
                customers in a commercial product — as long as you give
                attribution.
              </li>
              <li>
                Keep each record&apos;s <strong>validation status</strong> with
                it and label <strong>drafts</strong> as unverified.
              </li>
              <li>
                The registry contains <strong>no product images or logos</strong>
                . There is nothing to clear, and this license grants no rights in
                manufacturers&apos; photos or marks.
              </li>
              <li>
                Bulk-sync with the paged API (
                <code>include=document</code>, <code>updated_since</code>) and
                honor the <code>/api/v1/removals</code> feed.
              </li>
              <li>
                If you build on the data,{" "}
                <Link href="/implement/register">register your integration</Link>{" "}
                so we can tell you about removals and changes.
              </li>
            </ul>
          </div>

          <h2 id="scope">What this covers</h2>
          <p>
            These terms cover <strong>registry records</strong>: the{" "}
            <code>.odio</code> device, bundle, and cable documents served at{" "}
            <Link href="/registry">/registry</Link> and through the{" "}
            <Link href="/api-docs">REST API</Link>, together with the metadata
            the API returns about them. They also cover renderings generated
            from a record, such as the <code>?format=svg</code> I/O table and{" "}
            <code>?format=draw</code> programs.
          </p>
          <p>They do not cover:</p>
          <ul>
            <li>
              <strong>Code and JSON Schemas</strong>. These are licensed under
              Apache-2.0.
            </li>
            <li>
              <strong>The specification and documentation</strong>. These are
              licensed under CC BY 4.0, separately.
            </li>
            <li>
              <strong>Manufacturers&apos; own documents</strong>, such as the
              spec sheets, manuals, and product pages listed in a record&apos;s{" "}
              <code>provenance.sourceDocuments</code> or{" "}
              <code>device.productUrl</code>. They belong to their owners. Link
              to them rather than copying them.
            </li>
          </ul>

          <h2 id="license">The license</h2>
          <p>
            Registry records are made available under the{" "}
            <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a> license (
            <code>{DATA_LICENSE.spdx}</code>). Under it you may:
          </p>
          <ul>
            <li>
              copy and store records, in full or in part, in your own database;
            </li>
            <li>
              normalize, transform, and merge them with other data;
            </li>
            <li>
              display them to your staff, to signed-in customers, or publicly,
              including in a paid, commercial product;
            </li>
            <li>redistribute them, modified or not.</li>
          </ul>
          <p>
            The one condition is attribution, described below. No fee or
            permission is required, and registration is optional.
          </p>

          <h2 id="attribution">Attribution</h2>
          <p>
            Give credit wherever the data is shown, in any reasonable form for
            your medium. A credit line in your catalog or device view, or on a
            &ldquo;data sources&rdquo; page linked from it, is fine. Include:
          </p>
          <ol>
            <li>
              the source, <strong>OpenDeviceIO</strong>, and the license,{" "}
              <strong>{DATA_LICENSE.short}</strong>, with a link to the license;
            </li>
            <li>
              a link to the record, where reasonably practicable. Every API row
              carries a <code>registry_url</code> for this;
            </li>
            <li>
              a note that you changed the data, if you did (for example,
              &ldquo;normalized by Example Co.&rdquo;).
            </li>
          </ol>
          <p>Suggested credit line:</p>
          <CodeBlock language="text">{`${ATTRIBUTION_TEXT} · normalized by <your company>`}</CodeBlock>
          <p>
            Attribution must not suggest that OpenDeviceIO or a manufacturer
            endorses your product.
          </p>

          <h2 id="status">Validation status</h2>
          <p>
            Every record carries <code>provenance.validation.status</code>,
            which the API also returns as <code>validation_status</code>:
          </p>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>draft</code>
                </td>
                <td>
                  Machine-extracted from public manufacturer documents, or
                  hand-entered, and <strong>not yet human-reviewed</strong>. It
                  is useful as a starting point but may contain errors.
                </td>
              </tr>
              <tr>
                <td>
                  <code>reviewed</code>
                </td>
                <td>
                  Checked by an OpenDeviceIO reviewer against the source
                  documents.
                </td>
              </tr>
              <tr>
                <td>
                  <code>manufacturer-verified</code>
                </td>
                <td>
                  Published by an account the manufacturer controls, through
                  OpenDeviceIO&apos;s verified-publisher program.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            If you display records, keep the status with each one and show
            drafts in a way users can tell apart from reviewed and verified
            data. To take only checked data, filter with{" "}
            <code>status=reviewed,manufacturer-verified</code>.
          </p>

          <h2 id="images">Images &amp; trademarks</h2>
          <p>
            <strong>
              The registry does not contain product photos, logos, or
              manufacturer drawings
            </strong>
            , and the ODIO schema has no image field. No asset in the registry
            is &ldquo;cleared for display&rdquo; because there are none. This
            license grants no rights in manufacturers&apos; images. Obtain those
            from the manufacturer.
          </p>
          <p>
            If the registry adds images in future, each asset will carry its
            own source and rights fields, and none will be presented as cleared
            by default.
          </p>
          <p>
            Manufacturer and product names appear in records to identify real
            devices. They are trademarks of their owners and their use here does
            not imply endorsement.
          </p>

          <h2 id="sync">Export, sync &amp; limits</h2>
          <p>
            There is no separate bulk file. The supported export is the paged
            list API, which can embed each full document. See the{" "}
            <Link href="/api-docs#sync">API reference</Link> for parameters.
          </p>
          <CodeBlock language="http">{EXPORT_SNIPPET}</CodeBlock>
          <ul>
            <li>
              <strong>Page size:</strong> up to {LIST_MAX_LIMIT} rows, or{" "}
              {LIST_MAX_LIMIT_WITH_DOCUMENTS} with{" "}
              <code>include=document</code>. Results are totally ordered, so
              offset paging is stable.
            </li>
            <li>
              <strong>No API key</strong> is required, and no hard rate limit
              is enforced today. Please keep to roughly one request per second,
              run bulk syncs no more than daily, and cache responses. We may
              introduce keys or limits for heavy use. Registered integrations
              get advance notice.
            </li>
          </ul>

          <h2 id="integrations">Integration terms</h2>
          <p>
            The license above governs what you may do with the data. The points
            below are how we ask products that <strong>mirror</strong> the
            registry, whether through the API or by registering, to keep their
            copies accurate. Records are corrected, re-reviewed, and sometimes
            withdrawn at a manufacturer&apos;s request.
          </p>
          <ul>
            <li>
              <strong>Refresh</strong> your copy at least every{" "}
              {SYNC_INTERVAL_DAYS} days with <code>updated_since</code>, and
              update the validation status you display when it changes.
            </li>
            <li>
              <strong>Honor removals</strong>: delete or hide any id listed by{" "}
              <code>GET /api/v1/removals</code> within {REMOVAL_WINDOW_DAYS}{" "}
              days.
            </li>
            <li>
              <strong>Don&apos;t imply endorsement</strong> by OpenDeviceIO or
              a manufacturer, and don&apos;t present a draft or reviewed record
              as manufacturer-verified.
            </li>
            <li>
              <strong>Register</strong> at{" "}
              <Link href="/implement/register">/implement/register</Link> if
              you store or display the data in a product. We use your
              registration to send removal, correction, and change notices.
            </li>
          </ul>

          <h2 id="removals">Corrections &amp; removals</h2>
          <p>
            Anyone can ask for a record to be corrected, removed, or verified at{" "}
            <Link href="/correct">/correct</Link>. No account is needed. A link
            from every record page pre-fills the form for that record.
          </p>
          <ul>
            <li>
              <strong>Removals</strong> are completed within{" "}
              {REMOVAL_REQUEST_BUSINESS_DAYS} business days of the request, and the
              removed ids are published to{" "}
              <code>GET /api/v1/removals</code> so mirrors can delete them.
            </li>
            <li>
              <strong>Corrections</strong> are made to the registry record and
              reach mirrors through <code>updated_since</code>.
            </li>
            <li>
              <strong>A manufacturer can ask us to hide its unverified drafts</strong>{" "}
              until it has reviewed or published its own records. Hidden drafts
              are left out of the registry and API, and can be listed in the
              removal feed.
            </li>
            <li>
              <strong>Manufacturers</strong> can also become verified publishers
              and correct their own records directly; see{" "}
              <Link href="/manufacturers">For Manufacturers</Link>.
            </li>
          </ul>

          <h2 id="warranty">No warranty</h2>
          <p>
            Records are provided <strong>as is</strong>, without warranties of
            any kind, as set out in sections 5 and 6 of the{" "}
            {DATA_LICENSE.short} license. Draft records in particular may be
            incomplete or wrong. Confirm critical details against the
            manufacturer&apos;s current documentation before relying on them.
          </p>

          <h2 id="changes">Changes to these terms</h2>
          <p>
            These terms are versioned (current: <code>{DATA_TERMS_VERSION}</code>
            ). A change to the license will not withdraw rights already granted
            for records you obtained under it. Registered integrations are
            notified of changes before they take effect.
          </p>
        </article>
      </div>
    </div>
  );
}
