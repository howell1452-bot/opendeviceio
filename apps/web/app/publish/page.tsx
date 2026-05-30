import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { supabaseConfigured } from "@/lib/supabase-server";
import { PublishForm } from "./PublishForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Publish a verified file",
  description:
    "Upload a .odio.json file for your approved brand. It validates against the ODIO schema and publishes as manufacturer-verified."
};

export default async function PublishPage() {
  const configured = supabaseConfigured();
  const { user, client } = await getCurrentUser();
  const memberships = user && client ? await listMyMemberships(client) : [];
  const brands = memberships.map((m) => m.manufacturer);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
        Manufacturer publishing
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Publish a verified <code className="font-mono">.odio.json</code>
      </h1>
      <p className="mt-3 text-slate-600">
        Upload a document for one of your approved brands. It is validated
        against the ODIO schema, stamped <strong>manufacturer-verified</strong>,
        and upserted into the public registry (replacing any existing entry with
        the same id).
      </p>

      {!configured ? (
        <Notice>Publishing is not configured on this deployment yet.</Notice>
      ) : !user ? (
        <Notice>
          <Link className="font-semibold underline" href="/signin">
            Sign in
          </Link>{" "}
          to publish.
        </Notice>
      ) : brands.length === 0 ? (
        <Notice>
          You have no approved brands yet. Request access on the{" "}
          <Link className="font-semibold underline" href="/contribute">
            Contribute
          </Link>{" "}
          page first.
        </Notice>
      ) : (
        <div className="mt-8">
          <p className="mb-4 text-sm text-slate-600">
            Approved brands:{" "}
            {brands.map((b, i) => (
              <span key={b}>
                <span className="font-medium text-slate-900">{b}</span>
                {i < brands.length - 1 ? ", " : ""}
              </span>
            ))}
            . The document&apos;s manufacturer must match one of these.
          </p>
          <PublishForm brands={brands} />
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
      {children}
    </div>
  );
}
