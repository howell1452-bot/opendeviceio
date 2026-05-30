"use server";

import { getCurrentUser } from "@/lib/session";
import { generateToken, hashToken } from "@/lib/tokens";

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
