import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brandCategories, brandCounts, getBrandBySlug } from "@/lib/brands";
import { listRegistry } from "@/lib/registry";
import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { STATUS_FILTERS } from "@/lib/status-filters";
import { categoryFilterValues, categoryOptionLabel } from "@/lib/category-filter";
import { KindBadge, SourceBadge, StatusBadge } from "@/components/Badge";
import { brandPath } from "@/lib/site";
import { pageNumber } from "@/lib/paging";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export async function generateMetadata({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return { title: "Brand not found" };
  // The brand page is indexable even when every record is a draft (drafts
  // themselves stay noindex on their own pages). Filters (status, category)
  // canonicalize to the unfiltered page; pagination keeps ?page=N.
  const title = `${brand.name} devices`;
  const description =
    brand.description ??
    `${brand.name} device, bundle and cable records in the OpenDeviceIO registry, with their verification status.`;
  const canonical = brandPath(brand.slug, pageNumber((await searchParams).page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { url: canonical, title, description, siteName: "OpenDeviceIO", type: "website" }
  };
}

export default async function BrandPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandBySlug(slug);
  if (!brand || !brand.manufacturer) notFound();

  const status = first(sp.status);
  const category = first(sp.category);
  const page = pageNumber(sp.page);
  const statusFilter = STATUS_FILTERS.find((s) => s.value === status);

  const [{ user, client }, counts, categories, list] = await Promise.all([
    getCurrentUser(),
    brandCounts(brand.manufacturer),
    brandCategories(brand.manufacturer),
    listRegistry({
      manufacturer: brand.manufacturer,
      statuses: statusFilter ? [...statusFilter.statuses] : undefined,
      categoryIn: category ? categoryFilterValues(category) : undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    })
  ]);
  const memberships = user && client ? await listMyMemberships(client) : [];
  const isMember = memberships.some((m) => m.manufacturer === brand.manufacturer);
  const canManage = isMember || (user ? isAdminEmail(user.email) : false);
  const total = list.total ?? list.rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const merged = { status, category, page: String(page), ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== null && v !== "" && !(k === "page" && String(v) === "1")) p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Link href="/brands" className="text-sm font-medium text-brand-700 hover:text-brand-900">
        ← All brands
      </Link>

      <header className="mt-4 border-b border-slate-200 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{brand.name}</h1>
            <p className="mt-2">
              {brand.claimed_at ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                  Claimed by {brand.name}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                  Unclaimed
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <Link
                href={`/brands/${brand.slug}/manage`}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Manage brand
              </Link>
            ) : !brand.claimed_at ? (
              <Link
                href={`/brands/${brand.slug}/claim`}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Claim this brand
              </Link>
            ) : null}
          </div>
        </div>

        {brand.description ? <p className="mt-4 max-w-3xl text-slate-700">{brand.description}</p> : null}

        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {brand.website ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Website</dt>
              <dd>
                <a className="break-all text-brand-700 underline" href={brand.website} rel="nofollow noopener">
                  {brand.website.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
          ) : null}
          {brand.support_url ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Support</dt>
              <dd>
                <a className="break-all text-brand-700 underline" href={brand.support_url} rel="nofollow noopener">
                  {brand.support_url.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
          ) : null}
          {brand.data_contact ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Product data contact</dt>
              <dd className="break-all text-slate-700">{brand.data_contact}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <Count label="Unverified drafts" value={counts.unverified} href={`/brands/${brand.slug}${qs({ status: "unverified", page: 1 })}`} />
          <Count label="Reviewed" value={counts.reviewed} href={`/brands/${brand.slug}${qs({ status: "reviewed", page: 1 })}`} />
          <Count label="Manufacturer-verified" value={counts.verified} href={`/brands/${brand.slug}${qs({ status: "verified", page: 1 })}`} />
        </div>

        {!brand.claimed_at && !canManage ? (
          <p className="mt-5 text-sm text-slate-600">
            Work at {brand.name}?{" "}
            <Link className="font-medium text-brand-700 underline" href={`/brands/${brand.slug}/claim`}>
              Claim this brand
            </Link>{" "}
            to verify and maintain these records.
          </p>
        ) : null}
      </header>

      <form className="mt-6 flex flex-wrap items-end gap-3" action={`/brands/${brand.slug}`}>
        <label className="block text-xs font-medium text-slate-500">
          Status
          <select name="status" defaultValue={status} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
            <option value="">All</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {categories.length > 0 ? (
          <label className="block max-w-full text-xs font-medium text-slate-500">
            Category
            <select name="category" defaultValue={category} className="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryOptionLabel(c)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand-400">
          Filter
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500">
        {total} {total === 1 ? "record" : "records"}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </p>
      <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {list.rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/registry/${row.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                {row.model ?? row.id}
              </Link>
              <div className="break-all font-mono text-xs text-slate-500">{row.id}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <KindBadge kind={row.kind} />
              <StatusBadge status={row.validation_status} />
              <SourceBadge source={row.source_type} org={row.source_org} />
            </div>
          </li>
        ))}
        {list.rows.length === 0 ? <li className="px-4 py-6 text-sm text-slate-500">No records match.</li> : null}
      </ul>

      {pages > 1 ? (
        <nav className="mt-4 flex justify-between text-sm">
          {page > 1 ? (
            <Link className="font-medium text-brand-700 underline" href={`/brands/${brand.slug}${qs({ page: page - 1 })}`}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link className="font-medium text-brand-700 underline" href={`/brands/${brand.slug}${qs({ page: page + 1 })}`}>
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function Count({ label, value, href }: { label: string; value: number | null; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-200 bg-white px-2 py-3 hover:border-brand-300">
      <div className="text-2xl font-bold text-slate-900">{value ?? "–"}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </Link>
  );
}
