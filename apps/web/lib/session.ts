import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "./supabase-server";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * The authenticated user for this request (via getUser, which verifies the
 * token with the auth server), plus the request-scoped client. Returns
 * { user: null } when not signed in or when Supabase env is absent.
 */
export async function getCurrentUser(): Promise<{
  user: CurrentUser | null;
  client: SupabaseClient | null;
}> {
  const client = await getServerSupabase();
  if (!client) return { user: null, client: null };
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { user: null, client };
  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    client
  };
}

/** True when the email is in the comma-separated ADMIN_EMAILS env (case-insensitive). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
