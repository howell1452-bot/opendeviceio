"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase-browser";

// Client-side auth state for the header: shows "Sign in" when logged out and
// "Account" (with the user's email) when logged in. Degrades to a plain
// "Sign in" link when Supabase env is absent.

export function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setReady(true);
      return;
    }
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const base =
    "rounded-md px-2.5 py-1.5 font-medium transition sm:px-3";

  if (ready && email) {
    return (
      <Link
        href="/account"
        className={`${base} bg-brand-600 text-white hover:bg-brand-700`}
        title={email}
      >
        Account
      </Link>
    );
  }

  return (
    <Link
      href="/signin"
      className={`${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900`}
    >
      Sign in
    </Link>
  );
}
