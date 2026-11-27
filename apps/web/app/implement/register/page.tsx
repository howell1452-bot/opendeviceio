import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase-server";
import { listMyIntegrationRequests } from "@/lib/integrations";
import { DATA_LICENSE, DATA_TERMS_PATH, USE_CASES } from "@/lib/data-license";
import { IntegrationRequestForm } from "./IntegrationRequestForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/implement/register" },
  title: "Register an integration",
  description:
    "Software vendors: register your product's use of OpenDeviceIO registry data to get removal and correction notices and a confirmed record of the data terms."
};

export default async function RegisterIntegrationPage() {
  const configured = supabaseConfigured();
  const { user, client } = await getCurrentUser();
  const requests =
    user && client ? await listMyIntegrationRequests(client) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
        For design software vendors
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Register your integration
      </h1>
      <p className="mt-3 text-slate-600">
        If your product stores or displays OpenDeviceIO registry data — a staff
        catalog, a design tool&apos;s device library, a quoting system — register
        it here. Registration is free, and the public{" "}
        <Link className="text-brand-700 underline" href="/api-docs">
          read API
        </Link>{" "}
        stays open whether or not you register.
      </p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-base font-semibold text-slate-900">
          What registering gets you
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          <li>
            <strong className="text-slate-900">A written answer on use.</strong>{" "}
            You get an acknowledged record of your use case against the{" "}
            <Link className="text-brand-700 underline" href={DATA_TERMS_PATH}>
              data license and integration terms
            </Link>{" "}
            ({DATA_LICENSE.short}).
          </li>
          <li>
            <strong className="text-slate-900">
              Removal and correction notices.
            </strong>{" "}
            We email you when records are withdrawn or corrected, in addition to
            the machine-readable{" "}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">
              /api/v1/removals
            </code>{" "}
            feed.
          </li>
          <li>
            <strong className="text-slate-900">Advance notice of changes.</strong>{" "}
            You hear about API, schema, or terms changes before they ship.
          </li>
        </ul>
      </section>

      {!configured ? (
        <Notice tone="amber">
          Registration is not configured on this deployment yet.
        </Notice>
      ) : !user ? (
        <Notice tone="brand">
          <Link className="font-semibold underline" href="/signin?next=/implement/register">
            Sign in
          </Link>{" "}
          with your work email to register your integration.
        </Notice>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">
              Registration details
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Signed in as <strong>{user.email}</strong>. An OpenDeviceIO admin
              reviews each registration and will reply by email.
            </p>
            <div className="mt-4">
              <IntegrationRequestForm email={user.email ?? ""} />
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-slate-900">
              Your registrations
            </h2>
            {requests.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No registrations yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">
                        {r.company}
                        {r.product ? (
                          <span className="font-normal text-slate-500">
                            {" "}
                            · {r.product}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm text-slate-500">
                        {USE_CASES.find((u) => u.value === r.use_case)?.label ??
                          r.use_case}
                        {r.includes_drafts ? " · includes drafts" : ""} · terms{" "}
                        {r.terms_version}
                      </div>
                    </div>
                    <StatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 ring-amber-200",
    approved: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    declined: "bg-red-100 text-red-700 ring-red-200"
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        map[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
    >
      {status}
    </span>
  );
}

function Notice({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: "amber" | "brand";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-brand-200 bg-brand-50 text-brand-900";
  return (
    <div className={`mt-8 rounded-lg border p-4 text-sm ${cls}`}>{children}</div>
  );
}
