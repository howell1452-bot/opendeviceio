"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CONTRIBUTOR_TERMS_PATH,
  CONTRIBUTOR_TERMS_SUMMARY,
  CONTRIBUTOR_TERMS_VERSION
} from "@/lib/data-license";

export interface SubmitOrg {
  slug: string;
  name: string;
}

type Result =
  | { kind: "ok"; status: "published" | "pending" | "suggested"; recordId: string; message: string }
  | { kind: "error"; message: string; details?: string[] };

const OUTCOME_TEXT: Record<"published" | "pending" | "suggested", string> = {
  published: "Published as an unverified draft.",
  pending: "Saved. It's waiting for review before it appears in the registry.",
  suggested: "Saved as a suggested change. The record stays as it is until it's reviewed."
};

/**
 * Submit a .odio document to the registry through POST /api/v1/submissions.
 * Shared by /submit, /author and the /author editor. The server re-validates,
 * ignores the file's own validation status, and decides whether it publishes,
 * waits for review, or becomes a suggestion.
 */
export function SubmitToRegistry({
  document,
  disabled = false,
  orgs = [],
  baseRevisionId = null,
  label = "Submit to registry"
}: {
  /** The parsed document, or null while there is nothing valid to submit. */
  document: unknown | null;
  disabled?: boolean;
  orgs?: SubmitOrg[];
  baseRevisionId?: string | null;
  label?: string;
}) {
  const [accepted, setAccepted] = useState(false);
  const [note, setNote] = useState("");
  const [asOrg, setAsOrg] = useState(orgs[0]?.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const canSubmit = Boolean(document) && !disabled && accepted && !busy;

  async function submit() {
    if (!document) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          document,
          accept_terms: CONTRIBUTOR_TERMS_VERSION,
          ...(note.trim() ? { change_note: note.trim() } : {}),
          ...(asOrg ? { as_org: asOrg } : {}),
          ...(baseRevisionId ? { base_revision_id: baseRevisionId } : {})
        })
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: string[];
        status?: "published" | "pending" | "suggested";
        record_id?: string;
        message?: string;
      };
      if (!res.ok || !body.status || !body.record_id) {
        setResult({
          kind: "error",
          message: body.error ?? `Submission failed (HTTP ${res.status}).`,
          details: body.details
        });
      } else {
        setResult({
          kind: "ok",
          status: body.status,
          recordId: body.record_id,
          message: body.message ?? ""
        });
      }
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {orgs.length > 0 ? (
        <label className="block text-xs font-medium text-slate-600">
          Submit as
          <select
            value={asOrg}
            onChange={(e) => setAsOrg(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            {orgs.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name} (design software vendor)
              </option>
            ))}
            <option value="">Myself (community submission)</option>
          </select>
        </label>
      ) : null}

      <label className="block text-xs font-medium text-slate-600">
        What changed, and where the data came from (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 2000))}
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          placeholder="e.g. Added the second Dante port, from the spec sheet rev C."
        />
      </label>

      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          {CONTRIBUTOR_TERMS_SUMMARY}{" "}
          <Link href={CONTRIBUTOR_TERMS_PATH} className="underline">
            Contributor terms
          </Link>{" "}
          (version {CONTRIBUTOR_TERMS_VERSION}).
        </span>
      </label>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:opacity-40"
      >
        {busy ? "Submitting…" : label}
      </button>
      <p className="text-xs text-slate-500">
        Submissions show as <strong>unverified</strong>. Whatever the file says
        about its own validation status is ignored; only the manufacturer can
        verify a record.
      </p>

      {result?.kind === "ok" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
          <p className="font-medium">{OUTCOME_TEXT[result.status]}</p>
          {result.message ? <p className="mt-1 text-xs">{result.message}</p> : null}
          {result.status === "published" ? (
            <p className="mt-1 text-xs">
              View it at{" "}
              <Link className="font-mono underline" href={`/registry/${result.recordId}`}>
                /registry/{result.recordId}
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
      {result?.kind === "error" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
          <p className="font-medium">{result.message}</p>
          {result.details && result.details.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
              {result.details.slice(0, 20).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
