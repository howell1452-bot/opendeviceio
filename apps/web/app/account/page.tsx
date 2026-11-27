import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { getServiceSupabase, supabaseConfigured } from "@/lib/supabase-server";
import { loadBrandQueue } from "@/lib/submission-queue";
import { acceptInvitesFor } from "@/lib/invites";
import { SubmissionRow } from "@/components/SubmissionRow";
import { SignOutButton } from "@/components/SignOutButton";
import { TokenManager, type TokenRow } from "./TokenManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account",
  description: "Your OpenDeviceIO account, brands, and API tokens."
};

const SUBMISSION_STATUS: Record<string, string> = {
  pending: "Waiting for review",
  published: "Published (unverified)",
  suggested: "Suggested change, waiting for review",
  accepted: "Accepted",
  rejected: "Not accepted",
  superseded: "Published, since replaced",
  withdrawn: "Withdrawn"
};

export default async function AccountPage() {
  if (!supabaseConfigured()) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Account
        </h1>
        <p className="mt-3 text-slate-600">
          Accounts are not configured on this deployment yet.
        </p>
      </div>
    );
  }

  const { user, client } = await getCurrentUser();
  if (!user || !client) redirect("/signin?next=/account");

  // Apply any brand invites first, so a just-joined brand shows below.
  const inviteService = getServiceSupabase();
  if (inviteService) await acceptInvitesFor(inviteService, user);
  const memberships = await listMyMemberships(client);

  const { data: tokenData } = await client
    .from("api_tokens")
    .select("id,name,created_at,last_used_at")
    .order("created_at", { ascending: false });
  const tokens = (tokenData ?? []) as TokenRow[];

  // Suggested changes to the member's brands (read via RLS), and the user's
  // own submissions (service client filtered to this user: submitted_by is
  // not readable by clients).
  const service = getServiceSupabase();
  const brandNames = memberships.map((m) => m.manufacturer);
  const suggestions = await loadBrandQueue(client, service, brandNames);
  let mine: Array<{
    id: string;
    record_id: string;
    status: string;
    source_type: string;
    created_at: string;
    review_note: string | null;
  }> = [];
  if (service) {
    const { data } = await service
      .from("record_revisions")
      .select("id,record_id,status,source_type,created_at,review_note")
      .eq("submitted_by", user.id)
      .in("source_type", ["community", "design-vendor"])
      .order("created_at", { ascending: false })
      .limit(25);
    mine = (data ?? []) as typeof mine;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
        Account
      </h1>

      <section className="mt-6 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <div className="text-sm text-slate-500">Signed in as</div>
          <div className="font-medium text-slate-900">{user.email}</div>
        </div>
        <SignOutButton />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900">Your brands</h2>
        {memberships.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            No brands yet.{" "}
            <Link className="text-brand-700 underline" href="/brands/claim">
              Claim your brand
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {memberships.map((m) => (
              <li
                key={m.manufacturer}
                className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200"
              >
                {m.manufacturer}
              </li>
            ))}
          </ul>
        )}
        {memberships.length > 0 ? (
          <Link
            href="/publish"
            className="mt-4 inline-block text-sm font-medium text-brand-700 underline"
          >
            Publish a file →
          </Link>
        ) : null}
      </section>

      {memberships.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">Suggested changes</h2>
          <p className="mt-2 text-sm text-slate-600">
            Community and design-vendor submissions for your brands. Accepting
            one publishes it as <strong>manufacturer-verified</strong>; you can
            edit it first. Submitters&apos; names and emails aren&apos;t shown.
          </p>
          {suggestions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing waiting.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {suggestions.map((item) => (
                <SubmissionRow key={item.id} item={item} mode="brand" />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">Your submissions</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            None yet.{" "}
            <Link className="text-brand-700 underline" href="/submit">
              Submit a record
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
            {mine.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="break-all font-mono text-slate-900">{r.record_id}</span>
                  <span className="text-xs text-slate-500">
                    {SUBMISSION_STATUS[r.status] ?? r.status} · {r.created_at.slice(0, 10)}
                  </span>
                </div>
                {r.review_note ? (
                  <p className="mt-1 text-xs text-slate-600">Reviewer note: {r.review_note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">API tokens</h2>
        <p className="mt-2 text-sm text-slate-600">
          Mint a token to publish from CI or scripts via{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
            POST /api/v1/devices
          </code>
          . The token carries your brand scope; it can only publish files for
          your approved manufacturers. The plaintext is shown once at creation —
          store it securely.
        </p>
        <div className="mt-4">
          <TokenManager initialTokens={tokens} />
        </div>
      </section>
    </div>
  );
}
