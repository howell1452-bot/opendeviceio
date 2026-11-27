import { getSupabase } from "./supabase";

// Record id renames (0012_record_id_redirects.sql). A retired id answers with a
// 308 to its current id on the record page, the download route and the API;
// mirrors follow renames through GET /api/v1/redirects.

/**
 * The current id for `id`, given a lookup of old -> new ids. An exact match
 * wins; otherwise a "@revision" suffix is carried over from the base id
 * ("old/x@2" -> "new/x@2"). Null when `id` was never renamed.
 */
export function applyRedirect(id: string, lookup: ReadonlyMap<string, string>): string | null {
  const exact = lookup.get(id);
  if (exact) return exact;
  const at = id.indexOf("@");
  if (at > 0) {
    const base = lookup.get(id.slice(0, at));
    if (base) return base.includes("@") ? base : `${base}${id.slice(at)}`;
  }
  return null;
}

/** The ids to look up for `id`: itself and, with a "@" suffix, its base. */
export function redirectCandidates(id: string): string[] {
  const at = id.indexOf("@");
  return at > 0 ? [id, id.slice(0, at)] : [id];
}

/** Resolve a retired record id to its current id, or null. Public read. */
export async function resolveRedirect(id: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from("record_redirects")
      .select("old_id,new_id")
      .in("old_id", redirectCandidates(id));
    if (error || !data) return null;
    const lookup = new Map((data as Array<{ old_id: string; new_id: string }>).map((r) => [r.old_id, r.new_id]));
    return applyRedirect(id, lookup);
  } catch {
    return null;
  }
}

/** The current id prefix for a retired one ("attero-tech-by-qsc" -> "attero-tech"), or null. */
export async function redirectedPrefix(prefix: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase || !/^[a-z0-9][a-z0-9-]*$/.test(prefix)) return null;
  const { data } = await supabase
    .from("record_redirects")
    .select("new_id")
    .like("old_id", `${prefix}/%`)
    .limit(1)
    .maybeSingle();
  const newId = (data as { new_id: string } | null)?.new_id;
  return newId ? newId.split("/")[0] ?? null : null;
}

export interface RecordRedirect {
  old_id: string;
  new_id: string;
  created_at: string;
}

/** The public redirects feed, oldest first. */
export async function listRedirects(query: {
  since?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: RecordRedirect[]; total: number | null; unavailable: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], total: null, unavailable: true };
  try {
    let q = supabase.from("record_redirects").select("old_id,new_id,created_at", { count: "exact" });
    if (query.since) q = q.gte("created_at", query.since);
    const { data, error, count } = await q
      .order("created_at", { ascending: true })
      .order("old_id", { ascending: true })
      .range(query.offset, query.offset + query.limit - 1);
    if (error) return { rows: [], total: null, unavailable: true };
    return {
      rows: (data ?? []) as RecordRedirect[],
      total: typeof count === "number" ? count : null,
      unavailable: false
    };
  } catch {
    return { rows: [], total: null, unavailable: true };
  }
}
