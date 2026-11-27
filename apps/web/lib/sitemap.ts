import type { MetadataRoute } from "next";
import { getSupabase } from "./supabase";
import { listBrands } from "./brands";
import { absoluteUrl, brandPath, recordPath } from "./site";

// /sitemap.xml: the public pages, every brand page with at least one public
// record, and every public record under its current id.
//
// Records are read with the anon key, so the database's own visibility rules
// apply: a brand's hidden drafts are left out (0006), and renamed ids are not
// in the registry at all (their old ids live in record_redirects, 0012).
// Sign-in pages, dashboards and API routes are never listed.

/** Public pages, each with a self-canonical. */
export const SITEMAP_STATIC_PATHS = [
  "/",
  "/registry",
  "/brands",
  "/manufacturers",
  "/brands/claim",
  "/correct",
  "/implement",
  "/implement/register",
  "/guide",
  "/tools",
  "/viewer",
  "/api-docs",
  "/data-license",
  "/whitepaper",
  "/about",
  "/contribute"
] as const;

/** One sitemap file holds at most 50,000 URLs; split with generateSitemaps before reaching it. */
export const SITEMAP_MAX_URLS = 50_000;

const PAGE = 1000;

export interface SitemapRecord {
  id: string;
  manufacturer: string | null;
  updated_at: string | null;
}

export interface SitemapBrand {
  slug: string;
  manufacturer: string | null;
}

function date(v: string | null | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The sitemap entries for these records and brands (pure; see loadSitemap). */
export function buildSitemap(records: SitemapRecord[], brands: SitemapBrand[]): MetadataRoute.Sitemap {
  const latestByManufacturer = new Map<string, Date | undefined>();
  for (const r of records) {
    if (!r.manufacturer) continue;
    const d = date(r.updated_at);
    const prev = latestByManufacturer.get(r.manufacturer);
    if (!latestByManufacturer.has(r.manufacturer) || (d && (!prev || d > prev))) {
      latestByManufacturer.set(r.manufacturer, d);
    }
  }

  const entries: MetadataRoute.Sitemap = SITEMAP_STATIC_PATHS.map((p) => ({ url: absoluteUrl(p) }));

  const seenSlugs = new Set<string>();
  for (const b of [...brands].sort((a, z) => a.slug.localeCompare(z.slug))) {
    if (!b.manufacturer || !latestByManufacturer.has(b.manufacturer) || seenSlugs.has(b.slug)) continue;
    seenSlugs.add(b.slug);
    const lastModified = latestByManufacturer.get(b.manufacturer);
    entries.push({ url: absoluteUrl(brandPath(b.slug)), ...(lastModified ? { lastModified } : {}) });
  }

  for (const r of records) {
    const lastModified = date(r.updated_at);
    entries.push({ url: absoluteUrl(recordPath(r.id)), ...(lastModified ? { lastModified } : {}) });
  }

  return entries.slice(0, SITEMAP_MAX_URLS);
}

/** Every public record (id, manufacturer, updated_at), as anon. Empty if the DB is unreachable. */
export async function listSitemapRecords(): Promise<SitemapRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const out: SitemapRecord[] = [];
  for (let from = 0; from < SITEMAP_MAX_URLS; from += PAGE) {
    const { data, error } = await supabase
      .from("registry")
      .select("id,manufacturer,updated_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[odio] sitemap registry read failed:", error.message);
      break;
    }
    const rows = (data ?? []) as SitemapRecord[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadSitemap(): Promise<MetadataRoute.Sitemap> {
  const [records, brands] = await Promise.all([listSitemapRecords(), listBrands()]);
  return buildSitemap(records, brands);
}
