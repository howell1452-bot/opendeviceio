"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client for auth (magic-link sign in) and the signed-in
// user's own reads/writes. Uses the public anon key + cookie storage so the
// session is shared with the server (RLS runs as the user on both sides).
// Returns null when the public env is absent so client components degrade
// gracefully instead of throwing.

let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cached = createBrowserClient(url, key);
  return cached;
}
