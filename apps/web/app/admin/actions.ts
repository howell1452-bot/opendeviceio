"use server";

import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase-server";

// Admin actions for access-request review. Gated by ADMIN_EMAILS (the signed-in
// user's email must be in the list) and performed via the SERVICE client, which
// bypasses RLS to grant memberships and update request status.

async function requireAdminService() {
  const { user } = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return { error: "Not authorized.", service: null, admin: null as string | null };
  }
  const service = getServiceSupabase();
  if (!service) return { error: "Service key not configured.", service: null, admin: user.email };
  return { error: null, service, admin: user.email };
}

export async function approveRequest(
  requestId: string,
  userId: string,
  manufacturer: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service, admin } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const { error: memErr } = await service
    .from("manufacturer_members")
    .upsert(
      { user_id: userId, manufacturer, created_by: admin },
      { onConflict: "user_id,manufacturer" }
    );
  if (memErr) return { ok: false, error: memErr.message };

  const { error: reqErr } = await service
    .from("access_requests")
    .update({ status: "approved" })
    .eq("id", requestId);
  if (reqErr) return { ok: false, error: reqErr.message };

  return { ok: true };
}

export async function rejectRequest(
  requestId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const { error: reqErr } = await service
    .from("access_requests")
    .update({ status: "rejected" })
    .eq("id", requestId);
  if (reqErr) return { ok: false, error: reqErr.message };
  return { ok: true };
}

// ---- Integration registrations (software vendors consuming registry data) ----

export async function reviewIntegrationRequest(
  requestId: string,
  decision: "approved" | "declined"
): Promise<{ ok: boolean; error?: string }> {
  const { error, service, admin } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };
  if (decision !== "approved" && decision !== "declined") {
    return { ok: false, error: "Invalid decision." };
  }

  const { error: upErr } = await service
    .from("integration_requests")
    .update({
      status: decision,
      reviewed_by: admin,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", requestId);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}
