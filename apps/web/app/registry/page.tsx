import type { Metadata } from "next";
import Link from "next/link";
import { listRegistry, getFacets, type RegistryListRow } from "@/lib/registry";
import { KindBadge, StatusBadge, Chip } from "@/components/Badge";
import { RegistryFilters } from "@/components/RegistryFilters";

// Always render at request time so `next build` never depends on the DB.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registry",
  description:
    "Browse the OpenDeviceIO registry: a free, searchable, downloadable library of device, bundle, and cable .odio.json files."
};

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
    category: first(sp.category),
    connector: first(sp.connector)
  };

  const [{ rows, unavailable }, facets] = await Promise.all([
    listRegistry(query),
    getFacets()
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Device registry
        </h1>
        <p className="mt-3 text-slate-600">
          A free, read-only library of <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio.json</code>{" "}
          device, bundle, and cable files. Every entry is downloadable and shows its
          validation status. Search and filter below.
        </p>
      </div>

      <div className="mt-8">
        <RegistryFilters options={facets} initial={query} />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState unavailable={unavailable} filtered={Boolean(query.search || query.kind || query.category || query.connector)} />
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              {rows.length} {rows.length === 1 ? "entry" : "entries"}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <RegistryCard row={row} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function RegistryCard({ row }: { row: RegistryListRow }) {
  return (
    <Link
      href={`/registry/${row.id}`}
      className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-500">
            {row.manufacturer ?? "Unknown manufacturer"}
          </div>
          <div className="mt-0.5 truncate font-semibold text-slate-900">
            {row.model ?? row.id}
          </div>
        </div>
        <KindBadge kind={row.kind} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={row.validation_status} />
        {row.category ? <Chip>{row.category}</Chip> : null}
      </div>

      <div className="mt-auto flex items-center justify-between pt-4 text-xs text-slate-500">
        <span className="font-mono">{row.id}</span>
        {row.kind === "device" && typeof row.port_count === "number" ? (
          <span>
            {row.port_count} {row.port_count === 1 ? "port" : "ports"}
          </span>
        ) : null}
      </div>
    </Link>
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
