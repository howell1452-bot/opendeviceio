import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase-server";
import type { AccessRequest } from "@/lib/membership";
import { RequestRow } from "./RequestRow";

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
  let pending: AccessRequest[] = [];
  let configError: string | null = null;

  if (!service) {
    configError =
      "SUPABASE_SECRET_KEY is not set, so admin review is unavailable on this deployment.";
  } else {
    const { data, error } = await service
      .from("access_requests")
      .select("id,user_id,email,manufacturer,note,status,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) configError = error.message;
    else pending = (data ?? []) as AccessRequest[];
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
        Admin · access requests
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Signed in as <strong>{user.email}</strong>. Approving grants the
        requester membership in their named brand; they can then publish
        manufacturer-verified files for it.
      </p>

      {configError ? (
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {configError}
        </div>
      ) : pending.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No pending requests.</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {pending.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
