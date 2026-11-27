import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands";
import { getCurrentUser } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase-server";
import { listMyAccessRequests, listMyMemberships } from "@/lib/membership";
import { ACCESS_APPROVAL_BUSINESS_DAYS } from "@/lib/project";
import { ClaimForm } from "../../ClaimForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  return {
    title: brand ? `Claim ${brand.name} on OpenDeviceIO` : "Claim a brand",
    robots: { index: false, follow: true }
  };
}

export default async function ClaimBrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const { user, client } = await getCurrentUser();
  const memberships = user && client ? await listMyMemberships(client) : [];
  const requests = user && client ? await listMyAccessRequests(client) : [];
  const isMember = memberships.some((m) => m.manufacturer === brand.manufacturer);
  const openClaim = requests.find((r) => r.status === "pending" && r.manufacturer === brand.manufacturer);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <Link href={`/brands/${brand.slug}`} className="text-sm font-medium text-brand-700 hover:text-brand-900">
        ← {brand.name}
      </Link>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">
        Claim {brand.name} on OpenDeviceIO
      </h1>
      <p className="mt-3 text-slate-600">
        A claimed brand maintains its own records: publish manufacturer-verified
        files, invite colleagues, choose how community submissions are handled,
        and edit the brand profile.
      </p>
      {brand.claimed_at ? (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {brand.name} is already claimed. If you work there, claim it anyway and
          we&apos;ll check with the brand&apos;s team, or ask a colleague on the
          team to invite you.
        </p>
      ) : null}

      <div className="mt-8">
        {!supabaseConfigured() ? (
          <p className="text-sm text-slate-600">Accounts are not configured on this deployment yet.</p>
        ) : !user ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">
            <Link
              className="font-medium text-brand-700 underline"
              href={`/signin?next=${encodeURIComponent(`/brands/${brand.slug}/claim`)}`}
            >
              Sign in with your work email
            </Link>{" "}
            to claim {brand.name}. Sign-in is a one-time email link; there&apos;s no password.
          </div>
        ) : isMember ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
            You&apos;re on the {brand.name} team.{" "}
            <Link className="font-medium underline" href={`/brands/${brand.slug}/manage`}>
              Open the brand dashboard →
            </Link>
          </div>
        ) : openClaim ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">
            Your claim for {brand.name} is waiting for review. We confirm your email
            domain and approve within {ACCESS_APPROVAL_BUSINESS_DAYS} business days.
          </div>
        ) : (
          <ClaimForm
            email={user.email ?? ""}
            fixed={{ name: brand.name, slug: brand.slug }}
            approvalDays={ACCESS_APPROVAL_BUSINESS_DAYS}
          />
        )}
      </div>
    </div>
  );
}
