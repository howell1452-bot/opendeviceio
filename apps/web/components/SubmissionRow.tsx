"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/submission-queue";
import { statusLabel } from "@/components/Badge";
import { publishSubmission, rejectSubmission, suspendSubmitter } from "@/app/admin/actions";
import { acceptSuggestion, declineSuggestion } from "@/app/account/actions";

function Change({ label, added, removed }: { label: string; added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <li>
      {label}:{" "}
      {added.map((x) => (
        <span key={`+${x}`} className="mr-1 font-mono text-emerald-700">+{x}</span>
      ))}
      {removed.map((x) => (
        <span key={`-${x}`} className="mr-1 font-mono text-red-700">−{x}</span>
      ))}
    </li>
  );
}

/**
 * One open revision in a review queue. `mode` picks the actions: admins
 * publish / reject / suspend; brand members accept / edit / decline.
 */
export function SubmissionRow({ item, mode }: { item: QueueItem; mode: "admin" | "brand" }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Failed.");
    else {
      setDone(label);
      router.refresh();
    }
  }

  const target = item.isNew
    ? "New record"
    : `Replaces ${statusLabel(item.currentStatus).toLowerCase()} record`;
  const verifiedTarget = item.currentStatus === "manufacturer-verified";

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-mono font-semibold text-slate-900">
            {item.isNew ? item.recordId : <Link className="underline" href={`/registry/${item.recordId}`}>{item.recordId}</Link>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {item.sourceLabel} · {item.status === "pending" ? "Waiting for review" : "Suggested change"} ·{" "}
            {target} · {new Date(item.createdAt).toISOString().slice(0, 10)}
          </p>
          {mode === "admin" && item.submitter ? (
            <p className="mt-0.5 break-all text-xs text-slate-500">
              Submitter: {item.submitter.email ?? "(no email)"} · {item.submitter.acceptedCount} accepted
              {item.submitter.trusted ? " · trusted" : ""}
            </p>
          ) : null}
        </div>
      </div>

      {item.changeNote ? (
        <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
          {item.changeNote}
        </p>
      ) : null}

      <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
        <li>
          Ports: {item.before?.portCount ?? "–"} → {item.after.portCount ?? "–"}
        </li>
        <Change label="Connectors" {...item.connectors} />
        <Change label="Transports" {...item.transports} />
      </ul>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500">
          Document changes ({item.diff.total} {item.diff.total === 1 ? "path" : "paths"})
        </summary>
        <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-100">
          {item.diff.lines
            .map((l) =>
              l.op === "~"
                ? `~ ${l.path}: ${l.before} → ${l.after}`
                : l.op === "+"
                  ? `+ ${l.path}: ${l.after}`
                  : `- ${l.path}: ${l.before}`
            )
            .join("\n") || "(no differences)"}
          {item.diff.total > item.diff.lines.length
            ? `\n… ${item.diff.total - item.diff.lines.length} more`
            : ""}
        </pre>
      </details>

      {done ? (
        <p className="mt-3 text-xs font-medium text-emerald-700">Done: {done}.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional; the submitter can see it)"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            {mode === "admin" ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null || verifiedTarget}
                  title={verifiedTarget ? "Only the brand can accept changes to a verified record." : undefined}
                  onClick={() => void run("published", () => publishSubmission(item.id, note))}
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white enabled:hover:bg-emerald-700 disabled:opacity-40"
                >
                  {busy === "published" ? "Publishing…" : "Publish"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run("rejected", () => rejectSubmission(item.id, note))}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-red-400 disabled:opacity-40"
                >
                  {busy === "rejected" ? "Rejecting…" : "Reject"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm("Suspend this submitter? Their open submissions are rejected and they can't submit again.")) {
                      void run("submitter suspended", () => suspendSubmitter(item.id, note));
                    }
                  }}
                  className="rounded-md px-3 py-1 text-xs font-medium text-red-700 hover:underline disabled:opacity-40"
                >
                  Suspend submitter
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run("accepted and published as manufacturer-verified", () => acceptSuggestion(item.id))}
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white enabled:hover:bg-emerald-700 disabled:opacity-40"
                >
                  {busy ? "Working…" : "Accept and publish as verified"}
                </button>
                {!item.isNew ? (
                  <Link
                    href={`/author?id=${encodeURIComponent(item.recordId)}&revision=${item.id}`}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-brand-400"
                  >
                    Edit first
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run("declined", () => declineSuggestion(item.id, note))}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-red-400 disabled:opacity-40"
                >
                  Decline
                </button>
              </>
            )}
          </div>
          {mode === "admin" && verifiedTarget ? (
            <p className="text-xs text-slate-500">
              This record is manufacturer-verified; the brand decides. You can reject it.
            </p>
          ) : null}
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      )}
    </li>
  );
}
