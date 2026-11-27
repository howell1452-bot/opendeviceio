import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { normalizeManufacturer, type OdioDevice, type Bundle } from "@opendeviceio/sdk";
import { getRegistryRow, listPublicRevisions } from "@/lib/registry";
import {
  KindBadge,
  StatusBadge,
  SourceBadge,
  Chip,
  isUnverified,
  statusLabel
} from "@/components/Badge";
import { sourceLabel } from "@/lib/source";
import { brandCounts, brandSlugForPrefix, getBrandByManufacturer } from "@/lib/brands";
import { DeviceView } from "@/components/DeviceView";
import { BundleView } from "@/components/BundleView";
import { IoTableView } from "@/components/IoTableView";
import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { ReviewControls } from "./ReviewControls";
import { listMyMemberships } from "@/lib/membership";

// Fetch the row at request time; build must not depend on the DB.
export const dynamic = "force-dynamic";

function joinId(segments: string[] | undefined): string {
  return (segments ?? []).map((s) => decodeURIComponent(s)).join("/");
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string[] }>;
}): Promise<Metadata> {
  const { id: seg } = await params;
  const id = joinId(seg);
  const row = await getRegistryRow(id);
  if (!row) return { title: "Not found" };
  const name = [row.manufacturer, row.model].filter(Boolean).join(" ") || id;
  const unverified = isUnverified(row.validation_status);
  return {
    title: name,
    description: `${name} — an OpenDeviceIO ${row.kind} document (${statusLabel(row.validation_status).toLowerCase()}).`,
    // Keep unverified machine drafts out of search results under
    // manufacturers' product names. Reviewed and verified records are indexed.
    ...(unverified ? { robots: { index: false, follow: true } } : {})
  };
}

export default async function RegistryDetailPage({
  params
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id: seg } = await params;
  // A single segment is a brand, not a record: /registry/crestron (or an id
  // prefix like /registry/qsys) -> 308 to the brand page.
  if ((seg ?? []).length === 1) {
    const brandSlug = await brandSlugForPrefix(joinId(seg));
    if (brandSlug) permanentRedirect(`/brands/${brandSlug}`);
    notFound();
  }
  const id = joinId(seg);
  const row = await getRegistryRow(id);
  if (!row) notFound();
  const brand = await getBrandByManufacturer(row.manufacturer);

  // Show an Edit link only to signed-in manufacturers approved for this brand.
  const { user, client } = await getCurrentUser();
  const memberships = user && client ? await listMyMemberships(client) : [];
  const canEdit = Boolean(
    row.manufacturer &&
      memberships.some(
        (m) => (normalizeManufacturer(m.manufacturer) ?? m.manufacturer) === row.manufacturer
      )
  );

  const history = (await listPublicRevisions(row.id)) ?? [];
  // "Maintained by <Brand>" only once the claimed brand has verified records.
  const maintainedBy =
    brand?.claimed_at && row.manufacturer
      ? ((await brandCounts(row.manufacturer)).verified ?? 0) > 0
      : false;

  const doc = row.document as Record<string, unknown>;
  const provenance = doc.provenance as
    | {
        generator?: string;
        method?: string;
        sourceDocuments?: Array<{ title?: string; url?: string; retrieved?: string }>;
        validation?: { status?: string; by?: string; date?: string };
      }
    | undefined;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/registry"
        className="text-sm font-medium text-brand-700 hover:text-brand-900"
      >
        ← Back to registry
      </Link>

      {/* Identity header */}
      <header className="mt-4 border-b border-slate-200 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={row.kind} />
          <StatusBadge status={row.validation_status} />
          <SourceBadge source={row.source_type} org={row.source_org} />
          {row.odio_version ? (
            <span className="text-xs text-slate-400">ODIO {row.odio_version}</span>
          ) : null}
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
          {row.model ?? row.id}
        </h1>
        <p className="mt-1 text-lg text-slate-600">
          {brand ? (
            <Link href={`/brands/${brand.slug}`} className="hover:text-brand-700 hover:underline">
              {row.manufacturer}
            </Link>
          ) : (
            row.manufacturer
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs text-slate-500">{row.id}</span>
          {row.category ? <Chip>{row.category}</Chip> : null}
          {row.product_line ? (
            <span className="text-slate-500">{row.product_line}</span>
          ) : null}
          {row.sku ? (
            <span className="text-slate-400">SKU {row.sku}</span>
          ) : null}
        </div>

        <div className="mt-5">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Download
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <DownloadLink id={row.id} format="odio" label="ODIO (.odio)" primary />
            <DownloadLink id={row.id} format="dxf" label="DXF (CAD)" />
            <DownloadLink id={row.id} format="svg" label="I/O table (SVG)" />
            {canEdit ? (
              <Link
                href={`/author?id=${encodeURIComponent(row.id)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm transition hover:border-emerald-400"
              >
                {isUnverified(row.validation_status) ? "Verify / update this record →" : "Edit / update →"}
              </Link>
            ) : null}
          </div>
        </div>

        {user && isAdminEmail(user.email) ? (
          <ReviewControls id={row.id} status={row.validation_status} />
        ) : null}

        <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {brand && !canEdit && !brand.claimed_at ? (
            <Link
              href={`/brands/${brand.slug}/claim`}
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
            >
              Is this your product? Claim {brand.name} to verify and maintain it →
            </Link>
          ) : null}
          {brand && !canEdit && brand.claimed_at && maintainedBy ? (
            <Link href={`/brands/${brand.slug}`} className="font-medium text-emerald-800 hover:underline">
              Maintained by {brand.name}
            </Link>
          ) : null}
          <Link
            href={`/correct?id=${encodeURIComponent(row.id)}`}
            className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
          >
            {brand && !canEdit && !brand.claimed_at
              ? "Report an error or request removal →"
              : "Is this your product? Verify, correct, or request removal →"}
          </Link>
          {user && !canEdit ? (
            <Link
              href={`/author?id=${encodeURIComponent(row.id)}`}
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
            >
              Suggest a change →
            </Link>
          ) : null}
        </p>
      </header>

      {isUnverified(row.validation_status) ? (
        <div
          role="note"
          className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>
            {row.source_type === "community" ? (
              <>
                <strong>Unverified:</strong> submitted by a community member and
                not checked by the manufacturer. It may contain errors.
              </>
            ) : row.source_type === "design-vendor" ? (
              <>
                <strong>Unverified:</strong> submitted by{" "}
                {row.source_org ?? "a design software vendor"}
                {row.source_org ? ", a design software vendor," : ""} and not
                checked by the manufacturer. It may contain errors.
              </>
            ) : (
              <>
                <strong>Unverified draft:</strong>{" "}
                {provenance?.method === "llm-extraction"
                  ? "machine-extracted from the manufacturer's public documents"
                  : "compiled from public documents"}{" "}
                and not yet reviewed. It may contain errors.
              </>
            )}
          </p>
          <p className="mt-2">
            <Link
              href={`/correct?id=${encodeURIComponent(row.id)}`}
              className="font-semibold underline underline-offset-2"
            >
              Manufacturer? Verify or correct this record →
            </Link>
          </p>
        </div>
      ) : null}

      {/* Kind-specific body */}
      <div className="mt-8">
        {row.kind === "device" ? (
          <DeviceView device={row.document as OdioDevice} />
        ) : row.kind === "bundle" ? (
          <div className="space-y-10">
            <BundleView bundle={row.document as Bundle} />
            <IoTableView document={row.document as OdioDevice} />
          </div>
        ) : (
          <CableView doc={doc} />
        )}
      </div>

      {/* Provenance */}
      {provenance ? (
        <section className="mt-12 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-bold text-slate-900">Provenance</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {provenance.generator ? (
              <Field label="Generator" value={provenance.generator} />
            ) : null}
            {provenance.method ? (
              <Field
                label="Method"
                value={METHOD_LABELS[provenance.method] ?? provenance.method}
              />
            ) : null}
            {/* The registry decides verification; the file's own claim is not shown. */}
            <Field label="Validation" value={statusLabel(row.validation_status)} />
            <Field label="Source" value={sourceLabel(row.source_type, row.source_org)} />
            {provenance.validation?.date ? (
              <Field
                label={
                  isUnverified(row.validation_status)
                    ? "Drafted"
                    : row.validation_status === "manufacturer-verified"
                      ? "Verified"
                      : "Reviewed"
                }
                value={provenance.validation.date}
              />
            ) : null}
          </dl>
          {provenance.sourceDocuments?.length ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Source documents
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {provenance.sourceDocuments.map((s, i) => (
                  <li key={i}>
                    {s.url ? (
                      <a
                        href={s.url}
                        className="text-brand-700 underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.title ?? s.url}
                      </a>
                    ) : (
                      s.title ?? "(untitled)"
                    )}
                    {s.retrieved ? (
                      <span className="ml-2 text-xs text-slate-400">
                        retrieved {s.retrieved}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* History: published versions only, no personal names. */}
      {history.length > 0 ? (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">History</h2>
          <ol className="mt-4 divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <li key={h.revision_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-500">
                  {h.created_at.slice(0, 10)}
                </span>
                <span className="text-slate-800">{sourceLabel(h.source_type, h.source_org)}</span>
                <span className="text-xs text-slate-500">
                  {h.revision_id === row.revision_id
                    ? "Current version"
                    : h.status === "superseded"
                      ? "Replaced"
                      : "Published"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

const METHOD_LABELS: Record<string, string> = {
  "llm-extraction": "Machine-extracted (AI) from public documents",
  manual: "Entered by hand",
  manufacturer: "Published by the manufacturer"
};

function DownloadLink({
  id,
  format,
  label,
  primary
}: {
  id: string;
  format: "odio" | "dxf" | "svg";
  label: string;
  primary?: boolean;
}) {
  const cls = primary
    ? "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
    : "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-400 hover:text-brand-700";
  return (
    <a
      href={`/registry/download/${id}?format=${format}`}
      className={cls}
      download
    >
      <span aria-hidden>⬇</span> {label}
    </a>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function CableView({ doc }: { doc: Record<string, unknown> }) {
  const cable = (doc.cable ?? {}) as {
    manufacturer?: string;
    model?: string;
    lengthLabel?: string;
    lengthMeters?: number;
    factoryTerminated?: boolean;
    shielded?: boolean;
    ends?: Array<{ label?: string; connector?: string; gender?: string }>;
    carries?: Array<{ domain?: string; transport?: string }>;
  };
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cable.lengthLabel || typeof cable.lengthMeters === "number" ? (
          <Stat
            label="Length"
            value={cable.lengthLabel ?? `${cable.lengthMeters} m`}
          />
        ) : null}
        <Stat
          label="Terminated"
          value={cable.factoryTerminated ? "Factory" : "Field"}
        />
        {typeof cable.shielded === "boolean" ? (
          <Stat label="Shielded" value={cable.shielded ? "Yes" : "No"} />
        ) : null}
      </div>

      <h2 className="mt-10 text-xl font-bold text-slate-900">Ends</h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {(cable.ends ?? []).map((e, i) => (
          <span key={i} className="flex items-center gap-3">
            {i > 0 ? <span className="text-2xl text-slate-300">↔</span> : null}
            <span className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center">
              {e.label ? (
                <div className="text-xs text-slate-400">{e.label}</div>
              ) : null}
              <Chip>{e.connector ?? "?"}</Chip>
              {e.gender ? (
                <div className="mt-1 text-xs text-slate-500">{e.gender}</div>
              ) : null}
            </span>
          </span>
        ))}
      </div>

      {cable.carries?.length ? (
        <>
          <h2 className="mt-10 text-xl font-bold text-slate-900">Carries</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {cable.carries.map((c, i) => (
              <Chip key={i}>
                {c.domain}
                {c.transport ? ` · ${c.transport}` : ""}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}
