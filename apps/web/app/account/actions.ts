"use server";

import { normalizeManufacturer, validateDocument } from "@opendeviceio/sdk";
import { getCurrentUser } from "@/lib/session";
import { generateToken, hashToken } from "@/lib/tokens";
import { getServiceSupabase } from "@/lib/supabase-server";
import { membershipsForUser } from "@/lib/membership";
import { deriveRegistryRow, stampManufacturerVerified } from "@/lib/odio-row";
import {
  closeRevision,
  insertRevision,
  loadRecordState,
  publishRevision,
  recordAcceptance,
  type RevisionRow
} from "@/lib/revisions";

// Server actions for API token management. Generation + hashing happen on the
// server (node:crypto); the row is inserted via the USER's authenticated client
// so RLS scopes it to api_tokens rows the user owns. We return the plaintext to
// the caller exactly once — it is never stored.

export interface MintResult {
  ok: boolean;
  token?: string;
  id?: string;
  name?: string;
  created_at?: string | null;
  error?: string;
}

export async function mintToken(name: string): Promise<MintResult> {
  const { user, client } = await getCurrentUser();
  if (!user || !client) return { ok: false, error: "Not signed in." };

  const label = name.trim() || "token";
  const token = generateToken();
  const token_hash = hashToken(token);

  const { data, error } = await client
    .from("api_tokens")
    .insert({ user_id: user.id, name: label, token_hash })
    .select("id,name,created_at")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create token." };
  }
  return {
    ok: true,
    token,
    id: data.id as string,
    name: data.name as string,
    created_at: (data.created_at as string) ?? null
  };
}

export async function revokeToken(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { user, client } = await getCurrentUser();
  if (!user || !client) return { ok: false, error: "Not signed in." };
  const { error } = await client.from("api_tokens").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Suggested changes for a brand's records (provenance brief, item 6). The
// member's brand scope is re-checked here; writes use the service client.
// ---------------------------------------------------------------------------

async function brandReviewContext(revisionId: string) {
  const { user } = await getCurrentUser();
  if (!user) return { error: "Not signed in." } as const;
  const service = getServiceSupabase();
  if (!service) return { error: "Publishing is not configured on this deployment." } as const;

  const { data } = await service
    .from("record_revisions")
    .select("*")
    .eq("id", revisionId)
    .in("status", ["pending", "suggested"])
    .maybeSingle();
  const rev = data as RevisionRow | null;
  if (!rev) return { error: "This suggestion is no longer open." } as const;

  const brand = rev.manufacturer ? normalizeManufacturer(rev.manufacturer) ?? rev.manufacturer : null;
  const brands = (await membershipsForUser(service, user.id)).map(
    (b) => normalizeManufacturer(b) ?? b
  );
  if (!brand || !brands.includes(brand)) {
    return { error: "This suggestion isn't for one of your brands." } as const;
  }
  return { error: null, user, service, rev, brand } as const;
}

/**
 * Accept a suggestion as is: re-publish the suggested document as
 * manufacturer-verified for the brand, close the suggestion as accepted, and
 * credit its submitter. (To edit it first, open it in /author.)
 */
export async function acceptSuggestion(
  revisionId: string
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const ctx = await brandReviewContext(revisionId);
  if (ctx.error !== null) return { ok: false, error: ctx.error };
  const { user, service, rev, brand } = ctx;

  const v = validateDocument(rev.document);
  if (!v.valid) return { ok: false, error: "The suggested document no longer validates. Open it in the editor to fix it." };
  const stamped = stampManufacturerVerified(rev.document as never, brand);
  const row = deriveRegistryRow(stamped, v.kind);
  row.validation_status = "manufacturer-verified";

  const state = await loadRecordState(service, row.id);
  const inserted = await insertRevision(service, {
    record_id: row.id,
    document: row.document,
    manufacturer: row.manufacturer,
    source_type: "manufacturer",
    submitted_by: user.id,
    status: "pending",
    base_revision_id: rev.id,
    is_new_record: !state.exists
  });
  if (!inserted.ok) return { ok: false, error: inserted.error };

  const { error: pubErr } = await publishRevision(service, {
    revisionId: inserted.id,
    row,
    sourceType: "manufacturer"
  });
  if (pubErr) return { ok: false, error: pubErr };

  const { error: closeErr } = await closeRevision(service, rev.id, "accepted", brand, null);
  if (closeErr) return { ok: false, error: closeErr };
  if (rev.submitted_by) await recordAcceptance(service, rev.submitted_by);
  return { ok: true, id: row.id };
}

/** Decline a suggestion, with an optional note to the submitter. */
export async function declineSuggestion(
  revisionId: string,
  note: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await brandReviewContext(revisionId);
  if (ctx.error !== null) return { ok: false, error: ctx.error };
  const { error } = await closeRevision(ctx.service, ctx.rev.id, "rejected", ctx.brand, note);
  return error ? { ok: false, error } : { ok: true };
}
