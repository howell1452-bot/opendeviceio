import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase-server";
import {
  INTEGRATION_COLUMNS,
  type IntegrationRequest
} from "@/lib/integrations";
import { REMOVAL_REQUEST_BUSINESS_DAYS, USE_CASES } from "@/lib/data-license";
import {
  RECORD_REQUEST_COLUMNS,
  type RecordRequest
} from "@/lib/record-requests";
import { ClaimRow, type AdminClaim } from "./ClaimRow";
import { loadAdminClaims } from "@/lib/claim-queue";
import { IntegrationRow } from "./IntegrationRow";
import { RecordRequestRow } from "./RecordRequestRow";
import { BrandVisibilityRow } from "./BrandVisibilityRow";
import type { BrandOverviewRow } from "./actions";
import { loadAdminQueue, type QueueItem } from "@/lib/submission-queue";
import { SubmissionRow } from "@/components/SubmissionRow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false }
};

export default async function AdminPage() {
  const { user } = await getCurrentUser();
  // Gate: only configured admins may see this page at all.
  if (!user || !isAdminEmail(user.email)) {
    notFound();
  }

  const service = getServiceSupabase();
  let claims: AdminClaim[] = [];
  let configError: string | null = null;
  let integrationsPending: IntegrationRequest[] = [];
  let integrationsApproved: IntegrationRequest[] = [];
  let integrationsError: string | null = null;
  let brands: BrandOverviewRow[] = [];
  let brandsError: string | null = null;
  let recordRequests: RecordRequest[] = [];
  let recordRequestsError: string | null = null;
  let submissions: QueueItem[] = [];
  let submissionsError: string | null = null;

  if (!service) {
    configError =
      "SUPABASE_SECRET_KEY is not set, so admin review is unavailable on this deployment.";
  } else {
    try {
      submissions = await loadAdminQueue(service);
    } catch (e) {
      submissionsError = e instanceof Error ? e.message : String(e);
    }
    const [access, integrations, records, brandRows] = await Promise.all([
      loadAdminClaims(service).then(
        (data) => ({ data, error: null as { message: string } | null }),
        (e: unknown) => ({ data: [] as AdminClaim[], error: { message: e instanceof Error ? e.message : String(e) } })
      ),
      service
        .from("integration_requests")
        .select(INTEGRATION_COLUMNS)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: true }),
      service
        .from("record_requests")
        .select(RECORD_REQUEST_COLUMNS)
        .in("status", ["new", "in-progress"])
        .order("created_at", { ascending: true }),
      service.rpc("admin_brand_overview")
    ]);
    if (brandRows.error) brandsError = brandRows.error.message;
    else brands = (brandRows.data ?? []) as BrandOverviewRow[];
    if (records.error) recordRequestsError = records.error.message;
    else recordRequests = (records.data ?? []) as RecordRequest[];
    if (access.error) configError = access.error.message;
    else claims = access.data;

    if (integrations.error) {
      integrationsError = integrations.error.message;
    } else {
      const all = (integrations.data ?? []) as IntegrationRequest[];
      integrationsPending = all.filter((r) => r.status === "pending");
      integrationsApproved = all.filter((r) => r.status === "approved");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
        Admin
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Signed in as <strong>{user.email}</strong>.
      </p>

      {configError ? (
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {configError}
        </div>
      ) : (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-bold text-slate-900">Submissions</h2>
            <p className="mt-1 text-sm text-slate-600">
              Community and design-vendor uploads waiting for review, and
              suggested changes to reviewed or protected records. Publishing
              makes the revision the live record as an unverified draft with its
              own source label. Changes to manufacturer-verified records are the
              brand&apos;s to accept.
            </p>
            {submissionsError ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {submissionsError}
              </div>
            ) : submissions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">Nothing waiting.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {submissions.map((item) => (
                  <SubmissionRow key={item.id} item={item} mode="admin" />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">
              Record requests
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Corrections, removals, and verification requests filed on{" "}
              <code className="font-mono">/correct</code> (no sign-up). Removals
              are promised within {REMOVAL_REQUEST_BUSINESS_DAYS} business days.
            </p>
            {recordRequestsError ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {recordRequestsError}
              </div>
            ) : recordRequests.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No open requests.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {recordRequests.map((r) => (
                  <RecordRequestRow
                    key={r.id}
                    request={r}
                    removalWindowDays={REMOVAL_REQUEST_BUSINESS_DAYS}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">
              Brand visibility
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Hide a brand&apos;s unverified drafts from the registry and API until
              it opts in, e.g. when the manufacturer asks or while you contact
              them. Members of the brand still see them. Nothing is hidden by
              default.
            </p>
            {brandsError ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {brandsError}
              </div>
            ) : brands.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No brands in the registry.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {brands.map((b) => (
                  <BrandVisibilityRow key={b.manufacturer} brand={b} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">
              Brand claims
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Manufacturer reps claiming a brand. Approving adds them to the
              brand&apos;s team (the first member becomes its brand-admin),
              marks the brand claimed, and emails them. Free email addresses
              are never approved automatically.
            </p>
            {claims.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No pending claims.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {claims.map((c) => (
                  <ClaimRow key={c.id} claim={c} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">
              Integration registrations
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Software vendors that consume registry data. Approving confirms
              their registered use and adds them to the notice list below. It
              does not gate the public read API.
            </p>
            {integrationsError ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {integrationsError}
                <span className="mt-1 block text-amber-800">
                  If the table is missing, apply{" "}
                  <code className="font-mono">
                    supabase/migrations/0003_integration_requests.sql
                  </code>
                  .
                </span>
              </div>
            ) : integrationsPending.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No pending registrations.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {integrationsPending.map((r) => (
                  <IntegrationRow key={r.id} request={r} />
                ))}
              </ul>
            )}

            {integrationsApproved.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-base font-semibold text-slate-900">
                  Approved integrations · notice list
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Email these contacts about removals, corrections, and API or
                  terms changes.
                </p>
                <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm">
                  {integrationsApproved.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                    >
                      <span className="font-medium text-slate-900">
                        {r.company}
                        {r.product ? (
                          <span className="font-normal text-slate-500">
                            {" "}
                            · {r.product}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-slate-600">
                        {r.email} ·{" "}
                        {USE_CASES.find((u) => u.value === r.use_case)?.label ??
                          r.use_case}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  Copy all:{" "}
                  <span className="select-all font-mono">
                    {[
                      ...new Set(
                        integrationsApproved
                          .map((r) => r.email)
                          .filter((e): e is string => Boolean(e))
                      )
                    ].join(", ")}
                  </span>
                </p>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
