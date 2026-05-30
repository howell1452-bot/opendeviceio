"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mintToken, revokeToken } from "./actions";

export interface TokenRow {
  id: string;
  name: string;
  created_at: string | null;
  last_used_at: string | null;
}

function fmt(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return d;
  }
}

export function TokenManager({
  initialTokens
}: {
  initialTokens: TokenRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onMint(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPlaintext(null);
    startTransition(async () => {
      const res = await mintToken(name);
      if (!res.ok || !res.token) {
        setError(res.error ?? "Could not create token.");
        return;
      }
      setPlaintext(res.token);
      setName("");
      router.refresh();
    });
  }

  function onRevoke(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await revokeToken(id);
      if (!res.ok) {
        setError(res.error ?? "Could not revoke token.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <form onSubmit={onMint} className="flex flex-wrap items-end gap-3">
        <div className="grow">
          <label
            htmlFor="token-name"
            className="block text-sm font-medium text-slate-700"
          >
            Token name
          </label>
          <input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ci-publish"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Working…" : "Mint token"}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {plaintext ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy this token now — it will not be shown again.
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-white px-3 py-2 font-mono text-sm text-slate-900 ring-1 ring-amber-200">
            {plaintext}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(plaintext)}
            className="mt-2 text-xs font-medium text-amber-800 underline"
          >
            Copy to clipboard
          </button>
        </div>
      ) : null}

      <div className="mt-6">
        {initialTokens.length === 0 ? (
          <p className="text-sm text-slate-500">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {initialTokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{t.name}</div>
                  <div className="text-xs text-slate-500">
                    Created {fmt(t.created_at)} · Last used{" "}
                    {fmt(t.last_used_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(t.id)}
                  disabled={pending}
                  className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Using a token</p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">{`curl -X POST https://opendeviceio.org/api/v1/devices \\
  -H "Authorization: Bearer odio_..." \\
  -H "Content-Type: application/json" \\
  --data-binary @my-device.odio.json`}</pre>
        <p className="mt-2 text-xs text-slate-500">
          The document&apos;s manufacturer must be one of your approved brands.
          Returns <code>{`{ id, status }`}</code>.
        </p>
      </div>
    </div>
  );
}
