"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { approveRequest, rejectRequest } from "./actions";

export interface AdminClaim {
  id: string;
  email: string | null;
  manufacturer: string;
  note: string | null;
  requesterRole: string | null;
  createdAt: string | null;
  emailDomain: string | null;
  domainMatch: boolean | null;
  freeMail: boolean;
  suggestAddDomain: boolean;
  org: { name: string; slug: string; status: string; claimed: boolean; verifiedDomains: string[] } | null;
  members: Array<{ email: string | null; role: string }>;
}

export function ClaimRow({ claim }: { claim: AdminClaim }) {
  const [addDomain, setAddDomain] = useState(claim.suggestAddDomain);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; role?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      // No refresh: the decided claim would leave the queue and take this
      // confirmation with it. The list updates on the next page load.
      if (!res.ok) setError(res.error ?? "Failed.");
      else setDone(res.role ? `${label} as ${res.role}` : label);
    });
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {claim.org ? (
              <Link className="underline" href={`/brands/${claim.org.slug}`}>
                {claim.org.name}
              </Link>
            ) : (
              claim.manufacturer
            )}{" "}
            {claim.org ? <span className="font-mono text-xs text-slate-500">/{claim.org.slug}</span> : null}
            {claim.org?.status === "pending" ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">new brand, unlisted</span>
            ) : null}
            {claim.org?.claimed ? (
              <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">already claimed</span>
            ) : null}
          </p>
          <p className="mt-0.5 break-all text-xs text-slate-600">
            {claim.email ?? "(no email)"}
            {claim.requesterRole ? ` · ${claim.requesterRole}` : ""}
            {claim.createdAt ? ` · ${claim.createdAt.slice(0, 10)}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs">
        Email domain <span className="font-mono">{claim.emailDomain ?? "(none)"}</span>:{" "}
        {claim.freeMail ? (
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-800">
            free email provider: confirm another way
          </span>
        ) : claim.domainMatch ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">
            matches the brand&apos;s verified domains
          </span>
        ) : (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
            not a verified domain for this brand yet
          </span>
        )}
      </p>
      {claim.org && claim.org.verifiedDomains.length > 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          Verified domains: {claim.org.verifiedDomains.join(", ")}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-slate-500">
        Team:{" "}
        {claim.members.length === 0
          ? "none yet (this claimant would become the brand-admin)"
          : claim.members.map((m) => `${m.email ?? "?"} (${m.role})`).join(", ")}
      </p>
      {claim.note ? (
        <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">{claim.note}</p>
      ) : null}

      {done ? (
        <p className="mt-3 text-xs font-medium text-emerald-700">Done: {done}.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {claim.emailDomain && !claim.freeMail && !claim.domainMatch ? (
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={addDomain} onChange={(e) => setAddDomain(e.target.checked)} />
              Add <span className="font-mono">{claim.emailDomain}</span> to the brand&apos;s verified domains
            </label>
          ) : null}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for a rejection (emailed to the claimant)"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run("approved", () => approveRequest(claim.id, { addDomain }))}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white enabled:hover:bg-emerald-700 disabled:opacity-40"
            >
              {pending ? "Working…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run("rejected", () => rejectRequest(claim.id, note))}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-red-400 disabled:opacity-40"
            >
              Reject
            </button>
          </div>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      )}
    </li>
  );
}
