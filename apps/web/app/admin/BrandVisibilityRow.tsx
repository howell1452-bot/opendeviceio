"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setBrandHidden, type BrandOverviewRow } from "./actions";

export function BrandVisibilityRow({ brand }: { brand: BrandOverviewRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [publishRemovals, setPublishRemovals] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function apply(hidden: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setBrandHidden(brand.manufacturer, hidden, publishRemovals, note);
      if (!res.ok) setError(res.error ?? "Failed.");
      else {
        setConfirming(false);
        setPublishRemovals(false);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/registry?manufacturer=${encodeURIComponent(brand.manufacturer)}`}
            className="font-medium text-slate-900 hover:underline"
            target="_blank"
          >
            {brand.manufacturer}
          </Link>
          <div className="text-xs text-slate-500">
            {brand.drafts} unverified · {brand.reviewed} reviewed · {brand.verified} verified
            {brand.hidden && brand.note ? ` · “${brand.note}”` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {brand.hidden ? (
            <>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                drafts hidden
              </span>
              <button
                type="button"
                onClick={() => apply(false)}
                disabled={pending}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Show drafts
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming((v) => !v)}
              disabled={pending || brand.drafts === 0}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-50 disabled:opacity-40"
            >
              Hide drafts…
            </button>
          )}
        </div>
      </div>

      {confirming && !brand.hidden ? (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Hide {brand.drafts} unverified draft{brand.drafts === 1 ? "" : "s"} for{" "}
            <strong>{brand.manufacturer}</strong> from the registry and API. Reviewed and
            verified records stay visible. Reversible.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={publishRemovals}
              onChange={(e) => setPublishRemovals(e.target.checked)}
              className="mt-1"
            />
            <span>
              Also list them in the removal feed so integrations delete their copies (use when
              the brand asked for removal).
            </span>
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional), e.g. requested by product team"
            className="w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => apply(true)}
              disabled={pending}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              Hide drafts
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-amber-900 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </li>
  );
}
