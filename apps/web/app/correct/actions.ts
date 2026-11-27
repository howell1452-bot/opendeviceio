"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getSupabase } from "@/lib/supabase";

// Public "correct or remove a record" submission. Runs on the server with the
// public (anon) key: RLS + column grants allow INSERT only, and the database
// enforces rate limits (supabase/migrations/0005_record_requests.sql). This
// action adds a honeypot, a minimum fill time, and input validation.

export type RequestType = "correction" | "removal" | "verify";

export interface SubmitResult {
  ok: boolean;
  error?: string;
}

const MIN_FILL_MS = 3000;
const MAX_IDS = 200;
const ID_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*)?$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Accept ids, registry URLs, or API URLs; one per line / comma / space. */
export async function parseRecordIds(raw: string): Promise<string[]> {
  const out = new Set<string>();
  for (const token of raw.split(/[\s,]+/)) {
    let t = token.trim();
    if (!t) continue;
    t = t.replace(/^https?:\/\/[^/]+\/(?:registry|api\/v1\/devices)\//i, "");
    t = t.replace(/[?#].*$/, "").replace(/\/+$/, "");
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep as is */
    }
    t = t.toLowerCase();
    if (ID_RE.test(t)) out.add(t);
  }
  return [...out].slice(0, MAX_IDS);
}

function str(form: FormData, key: string, max: number): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function submitRecordRequest(form: FormData): Promise<SubmitResult> {
  // Honeypot: a field humans never see. Bots that fill it get a silent "ok".
  if (str(form, "website", 200)) return { ok: true };

  // Minimum fill time: the form stamps when it was rendered.
  const startedAt = Number(str(form, "started_at", 20));
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return { ok: false, error: "That was quick! Please check the form and submit again." };
  }

  const type = str(form, "request_type", 20) as RequestType;
  if (!["correction", "removal", "verify"].includes(type)) {
    return { ok: false, error: "Choose what you'd like us to do." };
  }
  const name = str(form, "name", 200);
  const company = str(form, "company", 200);
  const email = str(form, "email", 320);
  const details = str(form, "details", 5000);
  const rawIds = str(form, "record_ids", 20000);
  const recordIds = await parseRecordIds(rawIds);

  if (!name) return { ok: false, error: "Please enter your name." };
  if (!company) return { ok: false, error: "Please enter your company." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid work email." };
  if (rawIds && recordIds.length === 0) {
    return {
      ok: false,
      error:
        "We couldn't read those record ids. Paste ids like crestron/amp-2210ht or registry links."
    };
  }
  if (recordIds.length === 0 && !details) {
    return {
      ok: false,
      error: "Tell us which record(s) this is about, or describe the request in Details."
    };
  }
  if (type === "correction" && !details) {
    return { ok: false, error: "Please describe what needs correcting in Details." };
  }

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
  const salt = process.env.REQUEST_HASH_SALT ?? "odio-record-requests";
  const ipHash = ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex") : null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 500) || null;

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Requests aren't available on this deployment. Please email us instead." };
  }

  const { error } = await supabase.from("record_requests").insert({
    request_type: type,
    record_ids: recordIds,
    name,
    company,
    email,
    details: details || null,
    ip_hash: ipHash,
    user_agent: userAgent
  });

  if (error) {
    if (/rate_limited/.test(error.message)) {
      return {
        ok: false,
        error: error.message.replace(/^.*rate_limited:\s*/, "").replace(/^./, (c) => c.toUpperCase()) + "."
      };
    }
    // eslint-disable-next-line no-console
    console.error("[odio] record request insert failed:", error.message);
    return { ok: false, error: "Something went wrong saving your request. Please email us instead." };
  }
  return { ok: true };
}
