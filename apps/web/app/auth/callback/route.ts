import { NextResponse } from "next/server";
import { getServerSupabase, siteOrigin } from "@/lib/supabase-server";

// Magic-link landing route. Supabase redirects here with a `code` (PKCE) which
// we exchange for a session; the @supabase/ssr server client writes the session
// cookies via the Route Handler's mutable cookie store. On success we redirect
// to ?next (default /account). Resolved at request time.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/account";
  const origin = siteOrigin(req.url);

  if (!code) {
    return NextResponse.redirect(`${origin}/signin?error=missing_code`);
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/signin?error=not_configured`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/signin?error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/account"}`);
}
