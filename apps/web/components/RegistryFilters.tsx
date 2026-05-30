"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, type FormEvent } from "react";

export interface FilterOptions {
  kinds: string[];
  categories: string[];
  connectors: string[];
}

/**
 * Search + filter controls for the registry. Drives state through the URL query
 * string so the server component re-fetches at request time. No client data
 * fetching — the page stays a server component.
 */
export function RegistryFilters({
  options,
  initial
}: {
  options: FilterOptions;
  initial: { search: string; kind: string; category: string; connector: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(initial.search);

  useEffect(() => {
    setSearch(initial.search);
  }, [initial.search]);

  function pushWith(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    router.push(qs ? `/registry?${qs}` : "/registry");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    pushWith({ q: search });
  }

  const hasAny =
    initial.search || initial.kind || initial.category || initial.connector;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="sr-only">
            Search by manufacturer or model
          </label>
          <input
            id="q"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search manufacturer or model…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          Search
        </button>
      </form>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Select
          label="Kind"
          value={initial.kind}
          options={options.kinds}
          onChange={(v) => pushWith({ kind: v })}
        />
        <Select
          label="Category"
          value={initial.category}
          options={options.categories}
          onChange={(v) => pushWith({ category: v })}
        />
        <Select
          label="Connector"
          value={initial.connector}
          options={options.connectors}
          onChange={(v) => pushWith({ connector: v })}
        />
      </div>

      {hasAny ? (
        <button
          type="button"
          onClick={() => router.push("/registry")}
          className="mt-3 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
        >
          Clear all filters
        </button>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
