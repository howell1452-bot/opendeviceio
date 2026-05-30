import type { OdioDocument } from "@opendeviceio/sdk";
import { getSupabase } from "./supabase";

// A row of the `public.registry` table. The `document` column is the full
// .odio.json (device | bundle | cable).
export interface RegistryRow {
  id: string;
  kind: "device" | "bundle" | "cable";
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  product_line: string | null;
  sku: string | null;
  validation_status: "draft" | "reviewed" | "manufacturer-verified" | null;
  odio_version: string | null;
  port_count: number | null;
  connectors: string[] | null;
  transports: string[] | null;
  document: OdioDocument;
  created_at?: string | null;
  updated_at?: string | null;
}

// The columns we select for list views (everything except the heavy document).
const LIST_COLUMNS =
  "id,kind,manufacturer,model,category,product_line,sku,validation_status,odio_version,port_count,connectors,transports,created_at,updated_at";

export interface RegistryQuery {
  search?: string;
  kind?: string;
  category?: string;
  manufacturer?: string;
  connector?: string;
  transport?: string;
  /** Max rows to return. Defaults to no limit when omitted. */
  limit?: number;
  /** Row offset for pagination. Defaults to 0. */
  offset?: number;
}

export type RegistryListRow = Omit<RegistryRow, "document">;

export interface RegistryListResult {
  rows: RegistryListRow[];
  /**
   * Total rows matching the query, ignoring limit/offset. Null when the count
   * is unknown (e.g. DB unreachable).
   */
  total: number | null;
  /** True when the DB is unreachable / not configured (distinct from "0 rows"). */
  unavailable: boolean;
}

/**
 * List registry rows, applying optional search + filters. Always runs at request
 * time (callers mark their route dynamic). Returns an empty list (never throws)
 * when the DB is empty or unreachable so the site renders gracefully.
 *
 * When `limit`/`offset` are supplied a window is returned and `total` carries the
 * exact unpaginated match count (via Supabase `count: "exact"`).
 */
export async function listRegistry(
  query: RegistryQuery = {}
): Promise<RegistryListResult> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], total: null, unavailable: true };

  try {
    let q = supabase.from("registry").select(LIST_COLUMNS, { count: "exact" });

    if (query.kind) q = q.eq("kind", query.kind);
    if (query.category) q = q.eq("category", query.category);
    if (query.manufacturer) q = q.eq("manufacturer", query.manufacturer);
    if (query.connector) q = q.contains("connectors", [query.connector]);
    if (query.transport) q = q.contains("transports", [query.transport]);

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      const like = `%${term}%`;
      // Case-insensitive match across manufacturer / model / id.
      q = q.or(`manufacturer.ilike.${like},model.ilike.${like},id.ilike.${like}`);
    }

    q = q.order("manufacturer", { ascending: true }).order("model", {
      ascending: true
    });

    if (typeof query.limit === "number") {
      const offset = query.offset && query.offset > 0 ? query.offset : 0;
      q = q.range(offset, offset + query.limit - 1);
    } else if (query.offset && query.offset > 0) {
      // Offset without an explicit limit: page forward to the end of the table.
      q = q.range(query.offset, query.offset + 999999);
    }

    const { data, error, count } = await q;
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[odio] registry list error:", error.message);
      return { rows: [], total: null, unavailable: true };
    }
    return {
      rows: (data ?? []) as unknown as RegistryListRow[],
      total: typeof count === "number" ? count : null,
      unavailable: false
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[odio] registry list threw:", err);
    return { rows: [], total: null, unavailable: true };
  }
}

/** Fetch a single row (with its full document) by id, or null if not found. */
export async function getRegistryRow(id: string): Promise<RegistryRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("registry")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[odio] registry get error:", error.message);
      return null;
    }
    return (data as unknown as RegistryRow) ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[odio] registry get threw:", err);
    return null;
  }
}

/** Distinct, sorted facet values for the filter UI (best-effort). */
export interface RegistryFacets {
  kinds: string[];
  categories: string[];
  connectors: string[];
}

export async function getFacets(): Promise<RegistryFacets> {
  const supabase = getSupabase();
  if (!supabase) return { kinds: [], categories: [], connectors: [] };
  try {
    const { data, error } = await supabase
      .from("registry")
      .select("kind,category,connectors");
    if (error || !data) return { kinds: [], categories: [], connectors: [] };
    const kinds = new Set<string>();
    const categories = new Set<string>();
    const connectors = new Set<string>();
    for (const r of data as Array<{
      kind: string | null;
      category: string | null;
      connectors: string[] | null;
    }>) {
      if (r.kind) kinds.add(r.kind);
      if (r.category) categories.add(r.category);
      for (const c of r.connectors ?? []) connectors.add(c);
    }
    return {
      kinds: [...kinds].sort(),
      categories: [...categories].sort(),
      connectors: [...connectors].sort()
    };
  } catch {
    return { kinds: [], categories: [], connectors: [] };
  }
}
