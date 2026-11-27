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
  // ?next, else the odio_next cookie set by the sign-in form; local paths only.
  const cookieNext = /(?:^|;\s*)odio_next=([^;]*)/.exec(req.headers.get("cookie") ?? "")?.[1];
  let fromCookie = "";
  try {
    fromCookie = cookieNext ? decodeURIComponent(cookieNext) : "";
  } catch {
    /* malformed: ignore */
  }
  let next = url.searchParams.get("next") || fromCookie || "/account";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/account";
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

  const res = NextResponse.redirect(`${origin}${next}`);
  res.cookies.set("odio_next", "", { path: "/", maxAge: 0 });
  return res;
}
