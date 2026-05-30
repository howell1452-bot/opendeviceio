import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { supabaseConfigured } from "@/lib/supabase-server";
import { SignOutButton } from "@/components/SignOutButton";
import { TokenManager, type TokenRow } from "./TokenManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account",
  description: "Your OpenDeviceIO account, brands, and API tokens."
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

  const memberships = await listMyMemberships(client);

  const { data: tokenData } = await client
    .from("api_tokens")
    .select("id,name,created_at,last_used_at")
    .order("created_at", { ascending: false });
  const tokens = (tokenData ?? []) as TokenRow[];

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
            No approved brands yet.{" "}
            <Link className="text-brand-700 underline" href="/contribute">
              Request access
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
