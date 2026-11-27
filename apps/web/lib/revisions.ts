import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistryRow } from "./registry";
import { writeRegistryRow, type SourceType } from "./registry-write";
import {
  AUTO_TRUST_WINDOW_DAYS,
  earnsTrust,
  type CurrentRecord
} from "./conflict-rules";

// Server-only helpers for public.record_revisions (0008_record_submissions.sql).
// Every caller passes the service client: clients have no write grant.

export type RevisionStatus =
  | "pending"
  | "published"
  | "suggested"
  | "accepted"
  | "rejected"
  | "superseded"
  | "withdrawn";

export interface RevisionRow {
  id: string;
  record_id: string;
  document: Record<string, unknown>;
  manufacturer: string | null;
  source_type: SourceType;
  source_org_id: string | null;
  submitted_by: string | null;
  status: RevisionStatus;
  base_revision_id: string | null;
  is_new_record: boolean;
  change_note: string | null;
  terms_version: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/** Reviewer label stored for admin decisions (never a person's name or email). */
export const ADMIN_REVIEWER = "OpenDeviceIO";

export interface NewRevision {
  record_id: string;
  document: unknown;
  manufacturer: string | null;
  source_type: SourceType;
  source_org_id?: string | null;
  submitted_by: string | null;
  status: RevisionStatus;
  base_revision_id?: string | null;
  is_new_record: boolean;
  change_note?: string | null;
  terms_version?: string | null;
}

export type InsertResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

/**
 * Insert a revision. The 0008 trigger enforces rate limits and suspension;
 * its errors are mapped to 429 / 403 with the trigger's message.
 */
export async function insertRevision(
  service: SupabaseClient,
  rev: NewRevision
): Promise<InsertResult> {
  const { data, error } = await service
    .from("record_revisions")
    .insert({
      record_id: rev.record_id,
      document: rev.document,
      manufacturer: rev.manufacturer,
      source_type: rev.source_type,
      source_org_id: rev.source_org_id ?? null,
      submitted_by: rev.submitted_by,
      status: rev.status,
      base_revision_id: rev.base_revision_id ?? null,
      is_new_record: rev.is_new_record,
      change_note: rev.change_note ?? null,
      terms_version: rev.terms_version ?? null
    })
    .select("id")
    .single();
  if (error || !data) {
    const msg = error?.message ?? "Could not save the revision.";
    const m = /^(rate_limited|suspended):\s*(.*)$/s.exec(msg);
    if (m) {
      const text = m[2].charAt(0).toUpperCase() + m[2].slice(1) + ".";
      return { ok: false, status: m[1] === "rate_limited" ? 429 : 403, error: text };
    }
    return { ok: false, status: 500, error: `Could not save the revision: ${msg}` };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export interface PublishArgs {
  revisionId: string;
  row: RegistryRow;
  sourceType: SourceType;
  sourceOrgId?: string | null;
  /** Set when a reviewer (admin / brand) published it; omitted for automatic publishes. */
  reviewer?: string | null;
  reviewNote?: string | null;
}

/**
 * Make a revision the live version of its record: write the registry row
 * (pointing current_revision_id at it), mark the previously published
 * revision superseded, and mark this one published. Open suggestions on the
 * record are left as they are.
 */
export async function publishRevision(
  service: SupabaseClient,
  args: PublishArgs
): Promise<{ error: string | null }> {
  const { error: writeErr } = await writeRegistryRow(service, args.row, {
    sourceType: args.sourceType,
    sourceOrgId: args.sourceOrgId ?? null,
    currentRevisionId: args.revisionId
  });
  if (writeErr) {
    await service
      .from("record_revisions")
      .update({ status: "withdrawn", review_note: "The registry write failed." })
      .eq("id", args.revisionId)
      .in("status", ["pending"]);
    return { error: writeErr };
  }

  await service
    .from("record_revisions")
    .update({ status: "superseded" })
    .eq("record_id", args.row.id)
    .eq("status", "published")
    .neq("id", args.revisionId);

  const now = new Date().toISOString();
  const { error: markErr } = await service
    .from("record_revisions")
    .update({
      status: "published",
      ...(args.reviewer ? { reviewer: args.reviewer, reviewed_at: now } : {}),
      ...(args.reviewNote ? { review_note: args.reviewNote } : {})
    })
    .eq("id", args.revisionId);
  return { error: markErr ? markErr.message : null };
}

export interface RecordState {
  exists: boolean;
  manufacturer: string | null;
  currentRevisionId: string | null;
  current: CurrentRecord | null;
}

/** The registry record a submission targets, with its current revision's submitter. */
export async function loadRecordState(
  service: SupabaseClient,
  id: string
): Promise<RecordState> {
  const { data } = await service
    .from("registry")
    .select("id,manufacturer,validation_status,source_type,source_org_id,current_revision_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { exists: false, manufacturer: null, currentRevisionId: null, current: null };
  const r = data as {
    manufacturer: string | null;
    validation_status: string | null;
    source_type: SourceType | null;
    source_org_id: string | null;
    current_revision_id: string | null;
  };
  let submittedBy: string | null = null;
  if (r.current_revision_id) {
    const { data: rev } = await service
      .from("record_revisions")
      .select("submitted_by")
      .eq("id", r.current_revision_id)
      .maybeSingle();
    submittedBy = (rev as { submitted_by: string | null } | null)?.submitted_by ?? null;
  }
  return {
    exists: true,
    manufacturer: r.manufacturer,
    currentRevisionId: r.current_revision_id,
    current: {
      validationStatus: r.validation_status,
      sourceType: r.source_type ?? "machine-draft",
      sourceOrgId: r.source_org_id,
      submittedBy
    }
  };
}

export interface ContributorState {
  trusted: boolean;
  suspended: boolean;
  acceptedCount: number;
}

export async function loadContributor(
  service: SupabaseClient,
  userId: string
): Promise<ContributorState> {
  const { data } = await service
    .from("contributor_status")
    .select("trusted,suspended,accepted_count")
    .eq("user_id", userId)
    .maybeSingle();
  const c = data as { trusted: boolean; suspended: boolean; accepted_count: number } | null;
  return {
    trusted: Boolean(c?.trusted),
    suspended: Boolean(c?.suspended),
    acceptedCount: c?.accepted_count ?? 0
  };
}

/**
 * A reviewer accepted one of this contributor's revisions: bump
 * accepted_count, and set trusted when the last AUTO_TRUST_WINDOW_DAYS hold
 * enough accepted revisions and no rejections.
 */
export async function recordAcceptance(
  service: SupabaseClient,
  userId: string
): Promise<void> {
  const before = await loadContributor(service, userId);
  const since = new Date(Date.now() - AUTO_TRUST_WINDOW_DAYS * 86_400_000).toISOString();

  const [{ count: accepted }, { count: rejected }] = await Promise.all([
    service
      .from("record_revisions")
      .select("id", { count: "exact", head: true })
      .eq("submitted_by", userId)
      .gte("reviewed_at", since)
      .in("status", ["published", "accepted", "superseded"]),
    service
      .from("record_revisions")
      .select("id", { count: "exact", head: true })
      .eq("submitted_by", userId)
      .gte("reviewed_at", since)
      .eq("status", "rejected")
  ]);

  const trusted = before.trusted || earnsTrust(accepted ?? 0, rejected ?? 0);
  await service.from("contributor_status").upsert(
    {
      user_id: userId,
      accepted_count: before.acceptedCount + 1,
      trusted,
      suspended: before.suspended,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
}

/** Close a pending or suggested revision without publishing it. */
export async function closeRevision(
  service: SupabaseClient,
  revisionId: string,
  status: "rejected" | "accepted",
  reviewer: string,
  note: string | null
): Promise<{ error: string | null }> {
  const { data, error } = await service
    .from("record_revisions")
    .update({
      status,
      reviewer,
      reviewed_at: new Date().toISOString(),
      review_note: note && note.trim() ? note.trim().slice(0, 2000) : null
    })
    .eq("id", revisionId)
    .in("status", ["pending", "suggested"])
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "This revision is no longer open." };
  return { error: null };
}
