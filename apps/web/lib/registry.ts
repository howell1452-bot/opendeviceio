import type { OdioDocument } from "@opendeviceio/sdk";
import { normalizeManufacturer } from "@opendeviceio/sdk";
import { getSupabase } from "./supabase";
import { controlledCategoryOf } from "./category-filter";
import type { SourceType } from "./source";

// A row of the `public.registry` table. The `document` column is the full
// .odio file (device | bundle | cable), stored as its parsed object.
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
  /** Who submitted the current version (provenance tiers). */
  source_type?: SourceType;
  /** Name of the submitting organization (design vendor or brand), or null. */
  source_org?: string | null;
  /** The record's current revision (record_revisions.id). */
  revision_id?: string | null;
}

// The columns we select for list views (everything except the heavy document).
// source_org is embedded through registry.source_org_id -> organizations; the
// public can only see verified organizations' names.
const LIST_COLUMNS =
  "id,kind,manufacturer,model,category,product_line,sku,validation_status,odio_version,port_count,connectors,transports,created_at,updated_at,source_type,current_revision_id,source_org:organizations(name)";

type RawSourceFields = {
  source_type?: SourceType | null;
  current_revision_id?: string | null;
  source_org_id?: string | null;
  source_org?: { name: string } | { name: string }[] | null;
};

/** Flatten the embedded org and the revision pointer into the public row shape. */
function withSource<T extends RawSourceFields>(
  raw: T
): Omit<T, keyof RawSourceFields> & {
  source_type: SourceType;
  source_org: string | null;
  revision_id: string | null;
} {
  const { source_type, current_revision_id, source_org_id: _orgId, source_org, ...rest } = raw;
  const org = Array.isArray(source_org) ? source_org[0] : source_org;
  return {
    ...rest,
    source_type: source_type ?? "machine-draft",
    source_org: org?.name ?? null,
    revision_id: current_revision_id ?? null
  };
}

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
  /** Exact match on the stored category. */
  category?: string;
  /** Match any of these stored categories (the website's controlled filter). */
  categoryIn?: string[];
  /** Restrict to these source types (OR). Empty/omitted = all. */
  sources?: string[];
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
    if (query.sources && query.sources.length > 0) {
      q = q.in("source_type", query.sources);
    }
    if (query.updatedSince) q = q.gte("updated_at", query.updatedSince);
    if (query.kind) q = q.eq("kind", query.kind);
    if (query.category) q = q.eq("category", query.category);
    if (query.categoryIn && query.categoryIn.length > 0) {
      q = q.in("category", query.categoryIn);
    }
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
      rows: ((data ?? []) as unknown as RawSourceFields[]).map(
        (r) => withSource(r) as unknown as RegistryListRow
      ),
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
      .select("*,source_org:organizations(name)")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[odio] registry get error:", error.message);
      return null;
    }
    return data ? (withSource(data as RawSourceFields) as unknown as RegistryRow) : null;
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
        // Only controlled categories appear in the facet; raw spellings fold
        // into the controlled path they map to (see lib/category-filter.ts).
        const controlled = controlledCategoryOf(r.category);
        if (controlled) categories.add(controlled);
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

/**
 * Count registry rows (as the public sees them), optionally for one
 * manufacturer and/or a set of validation statuses. Null when unavailable.
 */
export async function countRegistry(query: {
  manufacturer?: string;
  statuses?: string[];
} = {}): Promise<number | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    let q = supabase.from("registry").select("id", { count: "exact", head: true });
    if (query.manufacturer) q = q.eq("manufacturer", query.manufacturer);
    if (query.statuses && query.statuses.length > 0) {
      // A missing status counts as a draft.
      q = query.statuses.includes("draft")
        ? q.or(`validation_status.in.(${query.statuses.join(",")}),validation_status.is.null`)
        : q.in("validation_status", query.statuses);
    }
    const { count, error } = await q;
    if (error) return null;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

/** A public history entry (record_revisions, published or superseded; no submitter). */
export interface PublicRevision {
  revision_id: string;
  status: "published" | "superseded";
  source_type: SourceType;
  source_org: string | null;
  created_at: string;
  document?: OdioDocument;
}

/**
 * A record's public history, newest first. Read as anon: RLS (0008b) limits it
 * to published/superseded revisions of publicly visible records.
 */
export async function listPublicRevisions(
  id: string,
  opts: { includeDocument?: boolean } = {}
): Promise<PublicRevision[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const cols = `id,status,source_type,created_at,source_org:organizations(name)${
      opts.includeDocument ? ",document" : ""
    }`;
    const { data, error } = await supabase
      .from("record_revisions")
      .select(cols)
      .eq("record_id", id)
      .in("status", ["published", "superseded"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[odio] revisions error:", error.message);
      return null;
    }
    return ((data ?? []) as unknown as Array<{
      id: string;
      status: "published" | "superseded";
      source_type: SourceType;
      created_at: string;
      source_org: { name: string } | { name: string }[] | null;
      document?: OdioDocument;
    }>).map((r) => {
      const org = Array.isArray(r.source_org) ? r.source_org[0] : r.source_org;
      return {
        revision_id: r.id,
        status: r.status,
        source_type: r.source_type,
        source_org: org?.name ?? null,
        created_at: r.created_at,
        ...(opts.includeDocument ? { document: r.document } : {})
      };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[odio] revisions threw:", err);
    return null;
  }
}

/** Public revision counts for a set of record ids (one RPC; ids not found count 0). */
export async function getRevisionCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("record_revision_counts", { p_ids: ids });
    if (error) return out;
    for (const r of (data ?? []) as Array<{ record_id: string; revision_count: number }>) {
      out.set(r.record_id, r.revision_count);
    }
  } catch {
    /* counts are best-effort */
  }
  return out;
}
