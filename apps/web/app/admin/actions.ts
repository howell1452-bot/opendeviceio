"use server";

import { normalizeManufacturer, validateDocument } from "@opendeviceio/sdk";
import { getCurrentUser, isAdminEmail } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase-server";
import { deriveRegistryRow } from "@/lib/odio-row";
import { isFreeMailDomain, roleForNewMember } from "@/lib/claim-rules";
import { claimApprovedEmail, claimRejectedEmail, sendEmail } from "@/lib/notify";
import {
  ADMIN_REVIEWER,
  closeRevision,
  publishRevision,
  recordAcceptance,
  type RevisionRow
} from "@/lib/revisions";

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

/**
 * Approve a brand claim (claim-your-brand brief, item 4). Everything comes
 * from the stored claim, not the client: the claimant, the brand (canonical
 * name, the same normalization the registry uses) and the email domain.
 * The brand's first member becomes its brand-admin; later ones publishers.
 * Optionally adds the claimant's email domain to the brand's verified
 * domains (never a free-mail domain). Marks the brand claimed and listed.
 */
export async function approveRequest(
  requestId: string,
  opts: { addDomain?: boolean } = {}
): Promise<{ ok: boolean; error?: string; role?: string }> {
  const { error, service, adminId } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const { data: reqRow } = await service
    .from("access_requests")
    .select("id,user_id,email,manufacturer,org_id,email_domain,status")
    .eq("id", requestId)
    .maybeSingle();
  const req = reqRow as {
    id: string;
    user_id: string;
    email: string | null;
    manufacturer: string;
    org_id: string | null;
    email_domain: string | null;
    status: string;
  } | null;
  if (!req) return { ok: false, error: "Claim not found." };
  if (req.status !== "pending") return { ok: false, error: `This claim is already ${req.status}.` };

  // The brand profile: the claim's org, else the one for its manufacturer.
  let orgQuery = service
    .from("organizations")
    .select("id,name,slug,manufacturer,claimed_at,status,verified_domains")
    .eq("kind", "manufacturer");
  orgQuery = req.org_id
    ? orgQuery.eq("id", req.org_id)
    : orgQuery.eq("manufacturer", normalizeManufacturer(req.manufacturer.trim()) ?? req.manufacturer.trim());
  const { data: orgRow } = await orgQuery.maybeSingle();
  const org = orgRow as {
    id: string;
    name: string;
    slug: string;
    manufacturer: string | null;
    claimed_at: string | null;
    status: string;
    verified_domains: string[];
  } | null;

  const brand =
    org?.manufacturer ?? normalizeManufacturer(req.manufacturer.trim()) ?? req.manufacturer.trim();
  if (!brand) return { ok: false, error: "Empty brand name." };

  const { data: existing } = await service
    .from("manufacturer_members")
    .select("user_id,role")
    .eq("manufacturer", brand);
  const members = ((existing ?? []) as Array<{ user_id: string; role: "publisher" | "brand-admin" }>).map(
    (m) => ({ userId: m.user_id, role: m.role })
  );
  const already = members.find((m) => m.userId === req.user_id);
  const role = already?.role ?? roleForNewMember(members);

  const { error: memErr } = await service.from("manufacturer_members").upsert(
    // created_by is a uuid FK to auth.users: the approving admin's user id.
    { user_id: req.user_id, manufacturer: brand, role, created_by: adminId },
    { onConflict: "user_id,manufacturer" }
  );
  if (memErr) return { ok: false, error: memErr.message };

  if (org) {
    const domains = new Set(org.verified_domains ?? []);
    if (opts.addDomain && req.email_domain && !isFreeMailDomain(req.email_domain)) {
      domains.add(req.email_domain);
    }
    const { error: orgErr } = await service
      .from("organizations")
      .update({
        claimed_at: org.claimed_at ?? new Date().toISOString(),
        status: org.status === "pending" ? "verified" : org.status,
        manufacturer: org.manufacturer ?? brand,
        verified_domains: [...domains]
      })
      .eq("id", org.id);
    if (orgErr) return { ok: false, error: orgErr.message };
  }

  const { error: reqErr } = await service
    .from("access_requests")
    .update({ status: "approved", decided_by: adminId, decided_at: new Date().toISOString() })
    .eq("id", requestId);
  if (reqErr) return { ok: false, error: reqErr.message };

  if (req.email) {
    await sendEmail(
      claimApprovedEmail({ to: req.email, brand: org?.name ?? brand, slug: org?.slug ?? "" })
    );
  }
  return { ok: true, role };
}

/** Reject a brand claim with an optional note, and tell the claimant. */
export async function rejectRequest(
  requestId: string,
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service, adminId } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const decisionNote = note?.trim() ? note.trim().slice(0, 2000) : null;
  const { data, error: reqErr } = await service
    .from("access_requests")
    .update({
      status: "rejected",
      decided_by: adminId,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("email,manufacturer")
    .maybeSingle();
  if (reqErr) return { ok: false, error: reqErr.message };
  const r = data as { email: string | null; manufacturer: string } | null;
  if (!r) return { ok: false, error: "This claim is no longer pending." };
  if (r.email) {
    await sendEmail(claimRejectedEmail({ to: r.email, brand: r.manufacturer, note: decisionNote }));
  }
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

// ---------------------------------------------------------------------------
// Submissions queue (provenance brief, item 6)
// ---------------------------------------------------------------------------

async function loadOpenRevision(
  service: NonNullable<ReturnType<typeof getServiceSupabase>>,
  revisionId: string
): Promise<RevisionRow | null> {
  const { data } = await service
    .from("record_revisions")
    .select("*")
    .eq("id", revisionId)
    .in("status", ["pending", "suggested"])
    .maybeSingle();
  return (data as RevisionRow | null) ?? null;
}

/**
 * Publish a pending or suggested community / design-vendor revision. It
 * becomes the record's live version as an unverified draft with its own
 * source. Manufacturer-verified records are never replaced here: suggestions
 * on them are the brand's to accept.
 */
export async function publishSubmission(
  revisionId: string,
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const rev = await loadOpenRevision(service, revisionId);
  if (!rev) return { ok: false, error: "This submission is no longer open." };
  if (rev.source_type !== "community" && rev.source_type !== "design-vendor") {
    return { ok: false, error: "Only community and design-vendor submissions are published here." };
  }

  const { data: current } = await service
    .from("registry")
    .select("validation_status")
    .eq("id", rev.record_id)
    .maybeSingle();
  if ((current as { validation_status: string | null } | null)?.validation_status === "manufacturer-verified") {
    return {
      ok: false,
      error: "The record is manufacturer-verified. Only the brand can accept changes to it; you can reject the suggestion."
    };
  }

  const v = validateDocument(rev.document);
  if (!v.valid) return { ok: false, error: "The submitted document no longer validates." };
  const row = deriveRegistryRow(rev.document as never, v.kind);
  row.validation_status = "draft";

  const { error: pubErr } = await publishRevision(service, {
    revisionId: rev.id,
    row,
    sourceType: rev.source_type,
    sourceOrgId: rev.source_org_id,
    reviewer: ADMIN_REVIEWER,
    reviewNote: note?.trim() ? note.trim().slice(0, 2000) : null
  });
  if (pubErr) return { ok: false, error: pubErr };
  if (rev.submitted_by) await recordAcceptance(service, rev.submitted_by);
  return { ok: true };
}

/** Reject a pending or suggested revision, with an optional note. */
export async function rejectSubmission(
  revisionId: string,
  note: string
): Promise<{ ok: boolean; error?: string }> {
  const { error, service } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };
  const { error: closeErr } = await closeRevision(service, revisionId, "rejected", ADMIN_REVIEWER, note);
  return closeErr ? { ok: false, error: closeErr } : { ok: true };
}

/**
 * Suspend the submitter of a revision: they can no longer submit, and their
 * open revisions are rejected. The user id never leaves the server.
 */
export async function suspendSubmitter(
  revisionId: string,
  note: string
): Promise<{ ok: boolean; error?: string; rejected?: number }> {
  const { error, service } = await requireAdminService();
  if (error || !service) return { ok: false, error: error ?? "Unavailable." };

  const { data } = await service
    .from("record_revisions")
    .select("submitted_by")
    .eq("id", revisionId)
    .maybeSingle();
  const userId = (data as { submitted_by: string | null } | null)?.submitted_by;
  if (!userId) return { ok: false, error: "This revision has no submitter account." };

  const { error: upErr } = await service.from("contributor_status").upsert(
    {
      user_id: userId,
      suspended: true,
      trusted: false,
      note: note.trim() ? note.trim().slice(0, 2000) : "Suspended from the submissions queue.",
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (upErr) return { ok: false, error: upErr.message };

  const { data: closed, error: rejErr } = await service
    .from("record_revisions")
    .update({
      status: "rejected",
      reviewer: ADMIN_REVIEWER,
      reviewed_at: new Date().toISOString(),
      review_note: "Submitter suspended."
    })
    .eq("submitted_by", userId)
    .in("status", ["pending", "suggested"])
    .select("id");
  if (rejErr) return { ok: false, error: rejErr.message };
  return { ok: true, rejected: closed?.length ?? 0 };
}
