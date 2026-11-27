import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listRegistry, getFacets, type RegistryListRow } from "@/lib/registry";
import { listBrands } from "@/lib/brands";
import { KindBadge, StatusBadge, SourceBadge, Chip } from "@/components/Badge";
import { SOURCE_FILTERS } from "@/lib/source";
import { RegistryFilters } from "@/components/RegistryFilters";
import { STATUS_FILTERS } from "@/lib/status-filters";
import { categoryFilterValues, categoryOptionLabel } from "@/lib/category-filter";
import { REGISTRY_PAGE_SIZE as PAGE_SIZE, listingQuery, pageCount, pageNumber } from "@/lib/paging";
import { Pager } from "@/components/Pager";

// Always render at request time so `next build` never depends on the DB.
export const dynamic = "force-dynamic";

/** Filters a pager link keeps (everything but page). */
const FILTER_KEYS = ["q", "kind", "manufacturer", "category", "connector", "status", "source"] as const;

export async function generateMetadata({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  // Page 1 is /registry; page N is /registry?page=N. Filters and search
  // (?manufacturer=, ?source=, ?q=, ...) are always dropped from the canonical.
  const page = pageNumber((await searchParams).page);
  return {
    alternates: { canonical: `/registry${listingQuery({ page })}` },
    title: page > 1 ? `Registry, page ${page}` : "Registry",
    description:
      "Browse the OpenDeviceIO registry: a free, searchable, downloadable library of device, bundle, and cable .odio files."
  };
}

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function RegistryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = {
    search: first(sp.q),
    kind: first(sp.kind),
    manufacturer: first(sp.manufacturer),
    category: first(sp.category),
    connector: first(sp.connector),
    status: first(sp.status),
    source: first(sp.source)
  };
  const statusFilter = STATUS_FILTERS.find((s) => s.value === query.status);
  const sourceFilter = SOURCE_FILTERS.find((s) => s.value === query.source);
  const page = pageNumber(sp.page);

  const [{ rows, total, unavailable }, facets] = await Promise.all([
    listRegistry({
      ...query,
      // The Category dropdown lists controlled paths; match every raw spelling.
      category: undefined,
      categoryIn: query.category ? categoryFilterValues(query.category) : undefined,
      statuses: statusFilter ? [...statusFilter.statuses] : undefined,
      sources: sourceFilter ? [sourceFilter.value] : undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    }),
    getFacets()
  ]);
  const matched = total ?? rows.length;
  const pages = pageCount(matched, PAGE_SIZE);
  // Past the last page is a 404 (page 1 of an empty result is not).
  if (!unavailable && page > pages) notFound();
  const filters: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = first(sp[k]);
    if (v) filters[k] = v;
  }
  const pageHref = (n: number) => `/registry${listingQuery({ ...filters, page: n })}`;
  const brandSlugs = new Map(
    (await listBrands()).map((b) => [b.manufacturer ?? b.name, b.slug] as const)
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Device registry
        </h1>
        <p className="mt-3 text-slate-600">
          A free, read-only library of <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code>{" "}
          device, bundle, and cable files. Every entry is downloadable and shows its
          validation status. Search and filter below.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Most entries are <strong>unverified drafts</strong>, machine-extracted
          from manufacturers&apos; public documents and not yet reviewed. Filter
          by status to see reviewed and manufacturer-verified records. Missing
          a device, or found a mistake?{" "}
          <Link className="text-brand-700 underline" href="/submit">
            Submit a record
          </Link>
          .
          Manufacturers can{" "}
          <Link className="text-brand-700 underline" href="/correct">
            correct or verify
          </Link>{" "}
          their records.
        </p>
      </div>

      <div className="mt-8">
        <RegistryFilters
          options={{
            ...facets,
            categoryLabels: Object.fromEntries(
              facets.categories.map((c) => [c, categoryOptionLabel(c)])
            )
          }}
          initial={query}
        />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState unavailable={unavailable} filtered={Boolean(query.search || query.kind || query.manufacturer || query.category || query.connector || query.status || query.source)} />
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500" data-testid="registry-total">
              {matched.toLocaleString("en-US")} {matched === 1 ? "entry" : "entries"}
              {pages > 1 ? ` · page ${page} of ${pages}` : ""}
            </p>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <RegistryCard row={row} brandSlug={brandSlugs.get(row.manufacturer ?? "")} />
                </li>
              ))}
            </ul>
            <Pager page={page} pages={pages} total={matched} pageSize={PAGE_SIZE} href={pageHref} label="Registry pages" />
          </>
        )}
      </div>
    </div>
  );
}

function RegistryCard({ row, brandSlug }: { row: RegistryListRow; brandSlug?: string }) {
  // A "stretched link" card: the model link covers the card, and the brand
  // link sits above it (links can't nest).
  return (
    <div className="reg-card">
      <div className="reg-card-head">
        <div className="min-w-0">
          <div className="reg-card-brand">
            {brandSlug ? (
              <Link href={`/brands/${brandSlug}`}>
                {row.manufacturer}
              </Link>
            ) : (
              row.manufacturer ?? "Unknown manufacturer"
            )}
          </div>
          <Link href={`/registry/${row.id}`} className="reg-card-model">
            {row.model ?? row.id}
          </Link>
        </div>
        <KindBadge kind={row.kind} />
      </div>

      <div className="reg-card-tags">
        <StatusBadge status={row.validation_status} />
        <SourceBadge source={row.source_type} org={row.source_org} />
        {row.category ? <Chip>{row.category}</Chip> : null}
      </div>

      <div className="reg-card-foot">
        <span className="font-mono">{row.id}</span>
        {row.kind === "device" && typeof row.port_count === "number" ? (
          <span>
            {row.port_count} {row.port_count === 1 ? "port" : "ports"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({
  unavailable,
  filtered
}: {
  unavailable: boolean;
  filtered: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
      <h2 className="text-lg font-semibold text-slate-800">
        {filtered ? "No matching entries" : "The registry is empty"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        {filtered ? (
          <>Try clearing some filters or broadening your search.</>
        ) : unavailable ? (
          <>
            The registry database is not reachable right now. The site still works —
            check back once it is seeded, or explore the{" "}
            <Link className="text-brand-700 underline" href="/guide">
              authoring guide
            </Link>
            .
          </>
        ) : (
          <>
            No device, bundle, or cable files have been published yet. The registry
            is seeded from the example corpus; see the{" "}
            <Link className="text-brand-700 underline" href="/guide">
              authoring guide
            </Link>{" "}
            to learn how files are produced.
          </>
        )}
      </p>
    </div>
  );
}
