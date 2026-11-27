"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IntegrationRequest } from "@/lib/integrations";
import { USE_CASES } from "@/lib/data-license";
import { reviewIntegrationRequest } from "./actions";

export function IntegrationRow({ request }: { request: IntegrationRequest }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "declined") {
    setError(null);
    startTransition(async () => {
      const res = await reviewIntegrationRequest(request.id, decision);
      if (!res.ok) setError(res.error ?? "Failed.");
      else router.refresh();
    });
  }

  const useCase =
    USE_CASES.find((u) => u.value === request.use_case)?.label ??
    request.use_case;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">
            {request.company}
            {request.product ? (
              <span className="font-normal text-slate-500">
                {" "}
                · {request.product}
              </span>
            ) : null}
          </div>
          <div className="text-sm text-slate-600">
            {request.email}
            {request.website ? (
              <>
                {" · "}
                <a
                  href={request.website}
                  className="text-brand-700 underline"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {request.website}
                </a>
              </>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {useCase}
            {request.includes_drafts ? " · includes drafts" : " · reviewed/verified only"}
            {" · terms "}
            {request.terms_version}
          </div>
          {request.note ? (
            <p className="mt-1 text-sm text-slate-500">{request.note}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("approved")}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => decide("declined")}
            disabled={pending}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
          >
            Decline
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </li>
  );
}
