import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Public, read-only access. The publishable (anon) key is safe to ship to the
// browser: RLS on `public.registry` permits SELECT only. We create the client
// lazily so a missing env var degrades to a graceful empty state rather than a
// build-time crash (per the "build with an empty/unreachable DB" requirement).

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[odio] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set; registry will be empty."
      );
    }
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false }
  });
  return cached;
}
