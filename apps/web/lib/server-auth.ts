import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase, getServiceSupabase } from "./supabase-server";
import { hashToken } from "./tokens";

// Who is calling a write endpoint? Either a cookie session (the website) or a
// Bearer API token (scripts / CI). Server-only.

export interface Caller {
  userId: string;
  email: string | null;
  via: "cookie" | "token";
  tokenId?: string;
}

export type CallerResult =
  | { ok: true; caller: Caller; service: SupabaseClient }
  | { ok: false; status: number; error: string };

/**
 * Resolve the caller and the service client used for the write. All registry
 * writes go through the service role (clients have no write grant), so a
 * deployment without SUPABASE_SECRET_KEY cannot publish: that is reported as
 * 503 rather than failing silently.
 */
export async function resolveCaller(req: Request): Promise<CallerResult> {
  const service = getServiceSupabase();
  if (!service) {
    return {
      ok: false,
      status: 503,
      error: "Publishing is not configured on this deployment (server key missing)."
    };
  }

  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && /^Bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^Bearer\s+/i, "").trim()
      : null;

  if (bearer) {
    const { data: tokenRow, error } = await service
      .from("api_tokens")
      .select("id,user_id")
      .eq("token_hash", hashToken(bearer))
      .maybeSingle();
    if (error || !tokenRow) return { ok: false, status: 401, error: "Invalid API token." };
    const row = tokenRow as { id: string; user_id: string };
    let email: string | null = null;
    try {
      const { data } = await service.auth.admin.getUserById(row.user_id);
      email = data?.user?.email ?? null;
    } catch {
      /* optional */
    }
    return {
      ok: true,
      service,
      caller: { userId: row.user_id, email, via: "token", tokenId: row.id }
    };
  }

  const client = await getServerSupabase();
  if (!client) return { ok: false, status: 401, error: "Authentication required." };
  const { data } = await client.auth.getUser();
  if (!data.user) return { ok: false, status: 401, error: "Authentication required." };
  return {
    ok: true,
    service,
    caller: { userId: data.user.id, email: data.user.email ?? null, via: "cookie" }
  };
}

/** Best-effort: record that an API token was just used. */
export async function touchToken(service: SupabaseClient, caller: Caller) {
  if (caller.via !== "token" || !caller.tokenId) return;
  await service
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", caller.tokenId);
}
