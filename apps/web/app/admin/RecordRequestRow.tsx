"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  REQUEST_TYPE_LABEL,
  type RecordRequest
} from "@/lib/record-requests";
import { removeRecordsForRequest, setRecordRequestStatus } from "./actions";

const TYPE_STYLE: Record<string, string> = {
  correction: "bg-sky-100 text-sky-800 ring-sky-200",
  removal: "bg-red-100 text-red-700 ring-red-200",
  verify: "bg-emerald-100 text-emerald-800 ring-emerald-200"
};

function businessDaysSince(iso: string): number {
  const start = new Date(iso);
  const now = new Date();
  let days = 0;
  const d = new Date(start);
  while (d < now) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (d <= now && day !== 0 && day !== 6) days++;
  }
  return days;
}

export function RecordRequestRow({
  request,
  removalWindowDays
}: {
  request: RecordRequest;
  removalWindowDays: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const domain = request.email.split("@")[1] ?? "";
  const age = businessDaysSince(request.created_at);
  const overdue = request.request_type === "removal" && age >= removalWindowDays;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
      else router.refresh();
    });
  }

  function onRemove() {
    const n = request.record_ids.length;
    if (
      !window.confirm(
        `Delete ${n} record(s) from the registry and publish them to the removal feed?\n\n${request.record_ids.join("\n")}`
      )
    ) {
      return;
    }
    run(() => removeRecordsForRequest(request.id));
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
            TYPE_STYLE[request.request_type] ?? ""
          }`}
        >
          {REQUEST_TYPE_LABEL[request.request_type] ?? request.request_type}
        </span>
        <span className="text-xs text-slate-500">
          {new Date(request.created_at).toLocaleString()} · {age} business day
          {age === 1 ? "" : "s"} old
        </span>
        {request.status === "in-progress" ? (
          <span className="text-xs font-medium text-amber-700">in progress</span>
        ) : null}
        {overdue ? (
          <span className="text-xs font-semibold text-red-700">
            past the {removalWindowDays}-day removal commitment
          </span>
        ) : null}
      </div>

      <div className="mt-2 text-sm text-slate-900">
        <strong>{request.name}</strong>, {request.company} ·{" "}
        <a className="text-brand-700 underline" href={`mailto:${request.email}`}>
          {request.email}
        </a>{" "}
        <span className="text-xs text-slate-500">(domain: {domain})</span>
      </div>

      {request.record_ids.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {request.record_ids.map((id) => (
            <li key={id}>
              <Link
                href={`/registry/${id}`}
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-brand-700 underline"
                target="_blank"
              >
                {id}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No record ids given.</p>
      )}

      {request.details ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{request.details}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {request.request_type === "removal" && request.record_ids.length > 0 ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            Remove {request.record_ids.length} record
            {request.record_ids.length === 1 ? "" : "s"} now
          </button>
        ) : null}
        {request.status === "new" ? (
          <button
            type="button"
            onClick={() => run(() => setRecordRequestStatus(request.id, "in-progress"))}
            disabled={pending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Mark in progress
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => run(() => setRecordRequestStatus(request.id, "resolved"))}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          Resolve
        </button>
        <button
          type="button"
          onClick={() => run(() => setRecordRequestStatus(request.id, "declined"))}
          disabled={pending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
        >
          Decline
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </li>
  );
}
