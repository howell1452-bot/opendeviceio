import { cookies } from "next/headers";
import {
  createServerClient,
  type CookieMethodsServer
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase clients for the App Router (Next 15: cookies() is async).
//
// - getServerSupabase(): an authenticated client bound to the request cookies.
//   Reads/writes run under the signed-in user's identity, so RLS enforces
//   brand scope (a user can only upsert registry rows for their memberships).
// - getServiceSupabase(): a server-only client using SUPABASE_SECRET_KEY
//   (sb_secret_...). Bypasses RLS — for ADMIN and TOKEN-API operations only.
//   NEVER import this into a client component.
//
// Every helper returns null when its env is missing so `next build` (and any
// request made before the owner configures env) degrades gracefully instead of
// crashing. Callers must handle null.

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const SECRET_ENV = "SUPABASE_SECRET_KEY";

/**
 * Authenticated, request-scoped Supabase client. Returns null when public
 * Supabase env is absent. Reads the session from cookies; in a Server
 * Component the cookie store is read-only (the set/remove no-op is fine — the
 * /auth/callback Route Handler is what actually writes the session cookies).
 */
export async function getServerSupabase(): Promise<SupabaseClient | null> {
  const url = process.env[URL_ENV];
  const key = process.env[ANON_ENV];
  if (!url || !key) return null;

  const cookieStore = await cookies();

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Called from a Server Component where the cookie store is immutable.
        // Safe to ignore: session refresh is handled by the callback route.
      }
    }
  };

  return createServerClient(url, key, { cookies: cookieMethods });
}

/**
 * Server-only service client (SUPABASE_SECRET_KEY). Bypasses RLS. Use ONLY for
 * admin operations and the Bearer-token write path. Returns null when the
 * secret key is not configured.
 */
export function getServiceSupabase(): SupabaseClient | null {
  const url = process.env[URL_ENV];
  const key = process.env[SECRET_ENV];
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** True when the public Supabase env is configured (auth features available). */
export function supabaseConfigured(): boolean {
  return Boolean(process.env[URL_ENV] && process.env[ANON_ENV]);
}

/** The site origin for building auth redirect URLs. */
export function siteOrigin(reqUrl?: string): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (reqUrl) {
    try {
      return new URL(reqUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return "https://opendeviceio.org";
}
