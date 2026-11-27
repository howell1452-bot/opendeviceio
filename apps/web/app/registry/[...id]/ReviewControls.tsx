"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordReviewStatus } from "@/app/admin/actions";

/** Admin-only: one-click "Mark reviewed" (and undo) on a record page. */
export function ReviewControls({
  id,
  status
}: {
  id: string;
  status: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = status ?? "draft";
  if (current === "manufacturer-verified") return null;

  function run(next: "reviewed" | "draft") {
    setError(null);
    startTransition(async () => {
      const res = await setRecordReviewStatus(id, next);
      if (!res.ok) setError(res.error ?? "Failed.");
      else router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <span className="font-medium">Admin review</span>
      {current === "draft" ? (
        <button
          type="button"
          onClick={() => run("reviewed")}
          disabled={pending}
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white transition hover:bg-sky-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Mark reviewed"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run("draft")}
          disabled={pending}
          className="rounded-md border border-sky-300 px-3 py-1.5 font-medium text-sky-800 transition hover:bg-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Revert to draft"}
        </button>
      )}
      <span className="text-xs text-sky-800">
        Checked against the source documents? This sets it to Reviewed, dated today.
      </span>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
