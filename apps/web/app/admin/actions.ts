"use server";

import { normalizeManufacturer } from "@opendeviceio/sdk";
import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase-server";

// Admin actions for access-request review. Gated by ADMIN_EMAILS (the signed-in
// user's email must be in the list) and performed via the SERVICE client, which
// bypasses RLS to grant memberships and update request status.

async function requireAdminService() {
  const { user } = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return {
      error: "Not authorized.",
      service: null,
      admin: null as string | null,
      adminId: null as string | null
    };
  }
  const service = getServiceSupabase();
  if (!service) {
    return { error: "Service key not configured.", service: null, admin: user.email, adminId: user.id };
  }
  return { error: null, service, admin: user.email, adminId: user.id };
}

export async function approveRequest(
  requestId: string,
  userId: string,
  manufacturer: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service, adminId } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  // Store the canonical brand name (the same normalization the registry
  // applies to documents), so "Crestron Electronics, Inc." grants "Crestron"
  // and RLS / publish checks match the registry rows.
  const brand = normalizeManufacturer(manufacturer.trim());
  if (!brand) return { ok: false, error: "Empty brand name." };

  const { error: memErr } = await service
    .from("manufacturer_members")
    .upsert(
      // created_by is a uuid FK to auth.users: the approving admin's user id.
      { user_id: userId, manufacturer: brand, created_by: adminId },
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

// ---- Brand visibility (hidden_until_opt_in) ---------------------------------

export interface BrandOverviewRow {
  manufacturer: string;
  drafts: number;
  reviewed: number;
  verified: number;
  hidden: boolean;
  note: string | null;
  updated_at: string | null;
}

/**
 * Hide or show a brand's unverified drafts everywhere public. With
 * `publishRemovals`, hiding also lists the drafts in GET /api/v1/removals so
 * mirrors delete them; showing again bumps updated_at and clears those
 * entries. See supabase/migrations/0006_brand_visibility.sql.
 */
export async function setBrandHidden(
  manufacturer: string,
  hidden: boolean,
  publishRemovals: boolean,
  note?: string
): Promise<{ ok: boolean; drafts?: number; tombstones?: number; error?: string }> {
  const { error, service, admin } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };
  const { data, error: rpcErr } = await service.rpc("admin_set_brand_hidden", {
    p_manufacturer: manufacturer,
    p_hidden: hidden,
    p_publish_removals: hidden && publishRemovals,
    p_note: note?.trim() || null,
    p_actor: admin
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };
  const res = (data ?? {}) as { drafts?: number; tombstones?: number };
  return { ok: true, drafts: res.drafts, tombstones: res.tombstones };
}

// ---- Review (P1-13): mark a draft "reviewed" in one click --------------------

/**
 * Set a record's validation status to "reviewed" (from draft) or back to
 * "draft" (undo). Writes provenance.validation {status, by, date} into the
 * document; `by` is the project, never a personal email, because documents are
 * public and mirrored. updated_at is bumped by the registry trigger, so
 * integrations pick the change up via updated_since. Manufacturer-verified
 * records are never changed here.
 */
export async function setRecordReviewStatus(
  id: string,
  status: "reviewed" | "draft"
): Promise<{ ok: boolean; error?: string }> {
  const { error, service } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };
  if (status !== "reviewed" && status !== "draft") {
    return { ok: false, error: "Invalid status." };
  }

  const { data: row, error: getErr } = await service
    .from("registry")
    .select("id,validation_status,document")
    .eq("id", id)
    .maybeSingle();
  if (getErr || !row) return { ok: false, error: getErr?.message ?? "Record not found." };

  const current = (row as { validation_status: string | null }).validation_status ?? "draft";
  if (current === "manufacturer-verified") {
    return { ok: false, error: "Manufacturer-verified records can't be changed here." };
  }
  if (status === "reviewed" && current !== "draft") {
    return { ok: false, error: `Record is already ${current}.` };
  }
  if (status === "draft" && current !== "reviewed") {
    return { ok: false, error: "Only reviewed records can be reverted to draft." };
  }

  const doc = JSON.parse(
    JSON.stringify((row as { document: Record<string, unknown> }).document)
  ) as Record<string, unknown>;
  const provenance = (doc.provenance as Record<string, unknown> | undefined) ?? {};
  const validation = (provenance.validation as Record<string, unknown> | undefined) ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const nextValidation: Record<string, unknown> =
    status === "reviewed"
      ? { ...validation, status: "reviewed", by: "OpenDeviceIO", date: today }
      : { ...validation, status: "draft" };
  if (status === "draft") delete nextValidation.by;
  doc.provenance = { ...provenance, validation: nextValidation };

  const { error: upErr } = await service
    .from("registry")
    .update({ validation_status: status, document: doc })
    .eq("id", id)
    // NULL status counts as draft; a plain .neq() would skip NULL rows.
    .or("validation_status.is.null,validation_status.neq.manufacturer-verified");
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}
