"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { claimBrand } from "./actions";

export interface ClaimBrandOption {
  name: string;
  slug: string;
}

/**
 * The claim form. With `fixed` it claims that brand; otherwise the brand is
 * picked from the listed brands (typeahead), or typed in only when it isn't
 * in the registry yet.
 */
export function ClaimForm({
  email,
  fixed,
  brands = [],
  approvalDays
}: {
  email: string;
  fixed?: ClaimBrandOption;
  brands?: ClaimBrandOption[];
  approvalDays: number;
}) {
  const [query, setQuery] = useState("");
  const [notListed, setNotListed] = useState(false);
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; slug?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const picked = useMemo(
    () => fixed ?? brands.find((b) => b.name.toLowerCase() === query.trim().toLowerCase()) ?? null,
    [fixed, brands, query]
  );
  const ready = Boolean(role.trim()) && (Boolean(picked) || (notListed && query.trim().length > 0));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setResult(null);
    startTransition(async () => {
      const res = await claimBrand({
        slug: picked?.slug,
        newBrandName: picked ? undefined : query.trim(),
        requesterRole: role,
        note
      });
      setResult(
        res.ok
          ? {
              ok: true,
              slug: res.slug,
              text: `Claim sent. We confirm your email domain and approve within ${approvalDays} business days. We'll email you at ${email}.`
            }
          : { ok: false, text: res.error }
      );
    });
  }

  if (result?.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-medium">{result.text}</p>
        {result.slug ? (
          <p className="mt-2">
            <Link className="underline" href={`/brands/${result.slug}`}>
              Back to the brand page
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {fixed ? null : (
        <div>
          <label htmlFor="brand" className="block text-sm font-medium text-slate-700">
            Brand
          </label>
          <input
            id="brand"
            list="brand-options"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            placeholder="Start typing your brand"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <datalist id="brand-options">
            {brands.map((b) => (
              <option key={b.slug} value={b.name} />
            ))}
          </datalist>
          {picked ? (
            <p className="mt-1 text-xs text-emerald-700">✓ {picked.name} is in the registry.</p>
          ) : query.trim() ? (
            <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={notListed} onChange={(e) => setNotListed(e.target.checked)} />
              <span>
                My brand isn&apos;t in the registry yet. Claim <strong>{query.trim()}</strong> as a new brand.
              </span>
            </label>
          ) : null}
        </div>
      )}

      <div>
        <label htmlFor="role" className="block text-sm font-medium text-slate-700">
          Your role
        </label>
        <input
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value.slice(0, 200))}
          placeholder="e.g. Product manager, Technical documentation"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Work email
        </label>
        <input
          id="email"
          value={email}
          readOnly
          className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        />
        <p className="mt-1 text-xs text-slate-500">
          The email you signed in with. To use another address, sign out and sign in with it.
        </p>
      </div>

      <div>
        <label htmlFor="note" className="block text-sm font-medium text-slate-700">
          Note (optional)
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 2000))}
          rows={3}
          placeholder="Anything that helps us confirm you, e.g. a link to your team page"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={!ready || pending}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-brand-700 disabled:opacity-40"
      >
        {pending ? "Sending…" : "Claim this brand"}
      </button>
      <p className="text-xs text-slate-500">
        We confirm your email domain and approve within {approvalDays} business days.
      </p>
      {result && !result.ok ? <p className="text-sm text-red-700">{result.text}</p> : null}
    </form>
  );
}
