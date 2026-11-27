"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizeManufacturer } from "@opendeviceio/sdk";
import type { AccessRequest } from "@/lib/membership";
import { approveRequest, rejectRequest } from "./actions";

export function RequestRow({ request }: { request: AccessRequest }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveRequest(
        request.id,
        request.user_id ?? "",
        request.manufacturer
      );
      if (!res.ok) setError(res.error ?? "Failed.");
      else router.refresh();
    });
  }

  function onReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectRequest(request.id);
      if (!res.ok) setError(res.error ?? "Failed.");
      else router.refresh();
    });
  }

  const brand = normalizeManufacturer(request.manufacturer.trim()) ?? request.manufacturer;
  const domain = (request.email ?? "").split("@")[1]?.toLowerCase() ?? "";
  const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Heuristic hint only: does a domain label (ignoring the TLD) contain the
  // brand, or vice versa? e.g. crestron.com -> Crestron, us.shure.com -> Shure.
  const labels = domain.split(".").slice(0, -1).map((l) => l.replace(/[^a-z0-9]/g, ""));
  const domainMatches =
    brandKey.length > 0 &&
    labels.some((l) => l.includes(brandKey) || (l.length >= 4 && brandKey.includes(l)));

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">
            {request.manufacturer}
          </div>
          <div className="text-sm text-slate-600">
            {request.email}{" "}
            <span
              className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                domainMatches
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {domainMatches ? "domain matches brand" : `check domain: ${domain || "none"}`}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Approving grants: <strong className="text-slate-700">{brand}</strong>
          </div>
          {request.note ? (
            <p className="mt-1 text-sm text-slate-500">{request.note}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={pending}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </li>
  );
}
