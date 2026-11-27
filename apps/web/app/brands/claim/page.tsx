import type { Metadata } from "next";
import Link from "next/link";
import { listBrands } from "@/lib/brands";
import { getCurrentUser } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase-server";
import { ACCESS_APPROVAL_BUSINESS_DAYS } from "@/lib/project";
import { ClaimForm } from "../ClaimForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/brands/claim" },
  title: "Claim your brand",
  description:
    "Manufacturers: claim your brand on OpenDeviceIO to publish manufacturer-verified records, manage your team and choose how community submissions are handled."
};

export default async function ClaimAnyBrandPage() {
  const [{ user }, brands] = await Promise.all([getCurrentUser(), listBrands()]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">For manufacturers</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Claim your brand</h1>
      <p className="mt-3 text-slate-600">
        Pick your brand from the registry. If it isn&apos;t there yet, type its
        name and we&apos;ll add it when we approve your claim. You can also{" "}
        <Link className="text-brand-700 underline" href="/brands">
          browse all brands
        </Link>
        .
      </p>
      <div className="mt-8">
        {!supabaseConfigured() ? (
          <p className="text-sm text-slate-600">Accounts are not configured on this deployment yet.</p>
        ) : !user ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">
            <Link className="font-medium text-brand-700 underline" href="/signin?next=/brands/claim">
              Sign in with your work email
            </Link>{" "}
            to claim your brand. Sign-in is a one-time email link; there&apos;s no password.
          </div>
        ) : (
          <ClaimForm
            email={user.email ?? ""}
            brands={brands.map((b) => ({ name: b.name, slug: b.slug }))}
            approvalDays={ACCESS_APPROVAL_BUSINESS_DAYS}
          />
        )}
      </div>
    </div>
  );
}
