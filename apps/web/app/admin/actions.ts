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

// ---- Record requests (public correct / remove / verify) ---------------------

export async function setRecordRequestStatus(
  requestId: string,
  status: "new" | "in-progress" | "resolved" | "declined",
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service, admin } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };
  if (!["new", "in-progress", "resolved", "declined"].includes(status)) {
    return { ok: false, error: "Invalid status." };
  }
  const done = status === "resolved" || status === "declined";
  const { error: upErr } = await service
    .from("record_requests")
    .update({
      status,
      ...(note !== undefined ? { admin_note: note || null } : {}),
      resolved_by: done ? admin : null,
      resolved_at: done ? new Date().toISOString() : null
    })
    .eq("id", requestId);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}

/**
 * Honor a removal request: delete the request's record ids from the registry
 * (the registry_removals trigger publishes each to GET /api/v1/removals), tag
 * the tombstones with the reason, and resolve the request.
 */
export async function removeRecordsForRequest(
  requestId: string
): Promise<{ ok: boolean; removed?: number; error?: string }> {
  const { error, service, admin } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const { data: req, error: getErr } = await service
    .from("record_requests")
    .select("id,record_ids")
    .eq("id", requestId)
    .maybeSingle();
  if (getErr || !req) return { ok: false, error: getErr?.message ?? "Request not found." };
  const ids = ((req as { record_ids: string[] }).record_ids ?? []).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "This request lists no record ids." };

  const { data: deleted, error: delErr } = await service
    .from("registry")
    .delete()
    .in("id", ids)
    .select("id");
  if (delErr) return { ok: false, error: delErr.message };

  // registry_removals is publicly readable: keep the reason generic (no
  // requester names).
  await service
    .from("registry_removals")
    .update({ reason: "Removed on request" })
    .in("id", ids)
    .is("reason", null);

  const removed = (deleted ?? []).length;
  const { error: upErr } = await service
    .from("record_requests")
    .update({
      status: "resolved",
      admin_note: `Removed ${removed} of ${ids.length} record(s).`,
      resolved_by: admin,
      resolved_at: new Date().toISOString()
    })
    .eq("id", requestId);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, removed };
}
