import type { Metadata } from "next";
import Link from "next/link";
import { listBrands } from "@/lib/brands";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Brands",
  description:
    "Every brand in the OpenDeviceIO registry. Manufacturers can claim their brand to verify and maintain their own records."
};

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function BrandsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = first((await searchParams).q).trim();
  const all = await listBrands();
  const brands = q ? all.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())) : all;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Brands</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Every brand with records in the registry. Manufacturers can{" "}
        <Link className="text-brand-700 underline" href="/brands/claim">
          claim their brand
        </Link>{" "}
        to verify and maintain their own records.
      </p>

      <form className="mt-6 flex max-w-md gap-2" action="/brands">
        <label htmlFor="q" className="sr-only">
          Search brands
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search brands"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Search
        </button>
      </form>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {brands.map((b) => (
          <li key={b.slug}>
            <Link
              href={`/brands/${b.slug}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-brand-300"
            >
              <span className="truncate font-medium text-slate-900">{b.name}</span>
              <span className={`shrink-0 text-xs ${b.claimed_at ? "text-emerald-700" : "text-slate-400"}`}>
                {b.claimed_at ? "Claimed" : "Unclaimed"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {brands.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">
          No brand matches &ldquo;{q}&rdquo;.{" "}
          <Link className="text-brand-700 underline" href="/brands/claim">
            Claim it as a new brand
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
