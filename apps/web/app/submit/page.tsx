import type { Metadata } from "next";
import { NOINDEX } from "@/lib/site";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { getServiceSupabase, supabaseConfigured } from "@/lib/supabase-server";
import { vendorOrgsForUser } from "@/lib/orgs";
import { CONTRIBUTOR_TERMS_PATH } from "@/lib/data-license";
import { SubmitForm } from "./SubmitForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: NOINDEX,
  title: "Submit a record",
  description:
    "Submit a .odio file to the OpenDeviceIO registry. Submissions are labelled by source and stay unverified unless the manufacturer verifies them."
};

export default async function SubmitPage() {
  const { user, client } = await getCurrentUser();

  let orgs: Array<{ slug: string; name: string }> = [];
  let brands: string[] = [];
  if (user && client) {
    brands = (await listMyMemberships(client)).map((m) => m.manufacturer);
    const service = getServiceSupabase();
    if (service) {
      orgs = (await vendorOrgsForUser(service, user.id)).map((o) => ({ slug: o.slug, name: o.name }));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Contribute</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Submit a record
      </h1>
      <p className="mt-3 text-slate-600">
        Add a device, bundle or cable to the registry, or update one, by
        submitting a <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code>{" "}
        file (JSON syntax). You can also{" "}
        <Link className="text-brand-700 underline" href="/author">
          build one from a form
        </Link>
        .
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>
          Submissions are labelled <strong>Community submission</strong> (or
          with your design-vendor organization&apos;s name) and stay{" "}
          <strong>unverified</strong>. Only the manufacturer can verify a
          record.
        </li>
        <li>
          A new contributor&apos;s first submissions are reviewed before they
          appear. Changes to a manufacturer-verified or reviewed record are
          saved as suggestions for the brand or the maintainers.
        </li>
        <li>
          Your name and email are never shown publicly. See the{" "}
          <Link className="text-brand-700 underline" href={CONTRIBUTOR_TERMS_PATH}>
            contributor terms
          </Link>
          .
        </li>
      </ul>

      <div className="mt-8">
        {!supabaseConfigured() ? (
          <p className="text-sm text-slate-600">Accounts are not configured on this deployment yet.</p>
        ) : !user ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">
            <p>
              <Link className="font-medium text-brand-700 underline" href="/signin?next=/submit">
                Sign in
              </Link>{" "}
              to submit. Any account works; no approval is needed.
            </p>
          </div>
        ) : (
          <SubmitForm orgs={orgs} brands={brands} />
        )}
      </div>

      <p className="mt-10 text-sm text-slate-500">
        Manufacturers: to publish manufacturer-verified records for your own
        brand, see{" "}
        <Link className="text-brand-700 underline" href="/manufacturers">
          For Manufacturers
        </Link>
        . Changes to the format itself are proposed on GitHub.
      </p>
    </div>
  );
}
