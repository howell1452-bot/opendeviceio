import type { OdioDocument } from "@opendeviceio/sdk";
import { normalizeManufacturer } from "@opendeviceio/sdk";
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
  /** Restrict to these validation statuses (OR). Empty/omitted = all. */
  statuses?: string[];
  /** ISO 8601 timestamp; only rows with updated_at >= this. */
  updatedSince?: string;
  /**
   * "name" (default): manufacturer, model, id — for browsing.
   * "updated": updated_at, id — for incremental sync.
   */
  sort?: "name" | "updated";
  /** Embed the full `document` in each row (export / bulk sync). */
  includeDocument?: boolean;
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

export type RegistryListRow = Omit<RegistryRow, "document"> & {
  /** Present only when the query set `includeDocument`. */
  document?: OdioDocument;
};

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
    const columns = query.includeDocument
      ? `${LIST_COLUMNS},document`
      : LIST_COLUMNS;
    let q = supabase.from("registry").select(columns, { count: "exact" });

    if (query.statuses && query.statuses.length > 0) {
      q = q.in("validation_status", query.statuses);
    }
    if (query.updatedSince) q = q.gte("updated_at", query.updatedSince);
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

    // Always end on the primary key so ordering is total and offset paging
    // never skips or repeats rows that tie on the leading sort columns.
    if (query.sort === "updated") {
      q = q
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true });
    } else {
      q = q
        .order("manufacturer", { ascending: true })
        .order("model", { ascending: true })
        .order("id", { ascending: true });
    }

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
  manufacturers: string[];
  categories: string[];
  connectors: string[];
}

const EMPTY_FACETS: RegistryFacets = {
  kinds: [],
  manufacturers: [],
  categories: [],
  connectors: []
};

export async function getFacets(): Promise<RegistryFacets> {
  const supabase = getSupabase();
  if (!supabase) return EMPTY_FACETS;
  try {
    const kinds = new Set<string>();
    const manufacturers = new Set<string>();
    const categories = new Set<string>();
    const connectors = new Set<string>();

    // Page through every row — a single select is capped (PostgREST default ~1000),
    // which would drop manufacturers seeded beyond the first page (e.g. QSC after
    // ~1.8k Crestron rows). We only pull the small facet columns.
    const PAGE = 1000;
    const MAX_ROWS = 50000; // safety bound
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await supabase
        .from("registry")
        .select("kind,manufacturer,category,connectors")
        .range(from, from + PAGE - 1);
      if (error) return from === 0 ? EMPTY_FACETS : pack();
      if (!data || data.length === 0) break;
      for (const r of data as Array<{
        kind: string | null;
        manufacturer: string | null;
        category: string | null;
        connectors: string[] | null;
      }>) {
        if (r.kind) kinds.add(r.kind);
        // Canonicalize for the facet so any un-migrated variant still folds into
        // its brand (storage is normalized on write, so this is belt-and-braces).
        if (r.manufacturer) manufacturers.add(normalizeManufacturer(r.manufacturer));
        if (r.category) categories.add(r.category);
        for (const c of r.connectors ?? []) connectors.add(c);
      }
      if (data.length < PAGE) break;
    }

    function pack(): RegistryFacets {
      return {
        kinds: [...kinds].sort(),
        manufacturers: [...manufacturers].sort((a, b) => a.localeCompare(b)),
        categories: [...categories].sort(),
        connectors: [...connectors].sort()
      };
    }
    return pack();
  } catch {
    return EMPTY_FACETS;
  }
}

/** A tombstone for a registry id that was deleted or renamed. */
export interface RegistryRemoval {
  id: string;
  kind: string | null;
  manufacturer: string | null;
  removed_at: string;
}

export interface RegistryRemovalsResult {
  rows: RegistryRemoval[];
  total: number | null;
  /** True when the DB (or the removals table) is unavailable. */
  unavailable: boolean;
}

/**
 * Removal feed: ids removed from the registry at or after `since`, oldest
 * first. Ids that were later re-published are not included (the tombstone is
 * cleared on re-insert). Backed by `registry_removals`
 * (supabase/migrations/0002_registry_sync.sql).
 */
export async function listRemovals(query: {
  since?: string;
  limit: number;
  offset: number;
}): Promise<RegistryRemovalsResult> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], total: null, unavailable: true };
  try {
    let q = supabase
      .from("registry_removals")
      .select("id,kind,manufacturer,removed_at", { count: "exact" });
    if (query.since) q = q.gte("removed_at", query.since);
    q = q
      .order("removed_at", { ascending: true })
      .order("seq", { ascending: true })
      .range(query.offset, query.offset + query.limit - 1);
    const { data, error, count } = await q;
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[odio] registry removals error:", error.message);
      return { rows: [], total: null, unavailable: true };
    }
    return {
      rows: (data ?? []) as RegistryRemoval[],
      total: typeof count === "number" ? count : null,
      unavailable: false
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[odio] registry removals threw:", err);
    return { rows: [], total: null, unavailable: true };
  }
}
