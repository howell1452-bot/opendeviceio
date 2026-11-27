import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeManufacturer } from "@opendeviceio/sdk";
import { getSupabase } from "./supabase";
import { countRegistry } from "./registry";
import { redirectedPrefix } from "./redirects";

// Brand profiles: public.organizations rows with kind = 'manufacturer'
// (0010_brand_profiles.sql). Public reads go through organizations_public as
// anon; dashboard and admin reads pass the service client.

export interface BrandProfile {
  id: string;
  name: string;
  slug: string;
  manufacturer: string | null;
  claimed_at: string | null;
  description: string | null;
  website: string | null;
  support_url: string | null;
  data_contact: string | null;
}

const PROFILE_COLUMNS =
  "id,name,slug,manufacturer,claimed_at,description,website,support_url,data_contact";

/** A listed brand by slug (public view), or null. */
export async function getBrandBySlug(slug: string): Promise<BrandProfile | null> {
  const supabase = getSupabase();
  if (!supabase || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const { data } = await supabase
    .from("organizations_public")
    .select(PROFILE_COLUMNS)
    .eq("kind", "manufacturer")
    .eq("slug", slug)
    .maybeSingle();
  return (data as BrandProfile | null) ?? null;
}

/** The listed brand profile for a registry manufacturer name, or null. */
export async function getBrandByManufacturer(
  manufacturer: string | null | undefined
): Promise<BrandProfile | null> {
  const supabase = getSupabase();
  if (!supabase || !manufacturer) return null;
  const canonical = normalizeManufacturer(manufacturer) ?? manufacturer;
  const { data } = await supabase
    .from("organizations_public")
    .select(PROFILE_COLUMNS)
    .eq("kind", "manufacturer")
    .eq("manufacturer", canonical)
    .maybeSingle();
  return (data as BrandProfile | null) ?? null;
}

/** Every listed brand, by name (the claim typeahead and the brand search). */
export async function listBrands(): Promise<
  Array<Pick<BrandProfile, "name" | "slug" | "manufacturer" | "claimed_at">>
> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("organizations_public")
    .select("name,slug,manufacturer,claimed_at")
    .eq("kind", "manufacturer")
    .order("name", { ascending: true })
    .limit(5000);
  return (data ?? []) as Array<Pick<BrandProfile, "name" | "slug" | "manufacturer" | "claimed_at">>;
}

/**
 * The brand slug for a single-segment /registry/<x> link: a brand slug, or an
 * id prefix the registry uses for that brand ("qsys" -> "qsc").
 */
export async function brandSlugForPrefix(prefix: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase || !/^[a-z0-9][a-z0-9-]*$/.test(prefix)) return null;
  const direct = await getBrandBySlug(prefix);
  if (direct) return direct.slug;
  const { data } = await supabase
    .from("registry")
    .select("manufacturer")
    .like("id", `${prefix}/%`)
    .limit(1)
    .maybeSingle();
  const manufacturer = (data as { manufacturer: string | null } | null)?.manufacturer;
  const viaRecords = (await getBrandByManufacturer(manufacturer))?.slug ?? null;
  if (viaRecords) return viaRecords;
  // A retired prefix whose records were renamed ("attero-tech-by-qsc").
  const current = await redirectedPrefix(prefix);
  return current && current !== prefix ? brandSlugForPrefix(current) : null;
}

export interface BrandCounts {
  unverified: number | null;
  reviewed: number | null;
  verified: number | null;
}

/** Record counts by status for a brand (the same numbers as /manufacturers?brand=). */
export async function brandCounts(manufacturer: string): Promise<BrandCounts> {
  const [unverified, reviewed, verified] = await Promise.all([
    countRegistry({ manufacturer, statuses: ["draft"] }),
    countRegistry({ manufacturer, statuses: ["reviewed"] }),
    countRegistry({ manufacturer, statuses: ["manufacturer-verified"] })
  ]);
  return { unverified, reviewed, verified };
}

// ---------------------------------------------------------------------------
// Server-only (service client)
// ---------------------------------------------------------------------------

export interface BrandOrg extends BrandProfile {
  status: "pending" | "verified" | "suspended";
  verified_domains: string[];
}

/** A brand org by slug, any status, including verified_domains. */
export async function getBrandOrgBySlug(
  service: SupabaseClient,
  slug: string
): Promise<BrandOrg | null> {
  const { data } = await service
    .from("organizations")
    .select(`${PROFILE_COLUMNS},status,verified_domains`)
    .eq("kind", "manufacturer")
    .eq("slug", slug)
    .maybeSingle();
  return (data as BrandOrg | null) ?? null;
}

export interface BrandMember {
  userId: string;
  email: string | null;
  role: "publisher" | "brand-admin";
  createdAt: string | null;
}

/** A brand's team, with emails (shown only on the brand dashboard and /admin). */
export async function listBrandMembers(
  service: SupabaseClient,
  manufacturer: string
): Promise<BrandMember[]> {
  const { data } = await service
    .from("manufacturer_members")
    .select("user_id,role,created_at")
    .eq("manufacturer", manufacturer)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Array<{ user_id: string; role: BrandMember["role"]; created_at: string | null }>;
  return Promise.all(
    rows.map(async (r) => {
      let email: string | null = null;
      try {
        const { data: u } = await service.auth.admin.getUserById(r.user_id);
        email = u?.user?.email ?? null;
      } catch {
        /* shown as unknown */
      }
      return { userId: r.user_id, email, role: r.role, createdAt: r.created_at };
    })
  );
}

/** Controlled categories a brand has records in (for the brand page filter). */
export async function brandCategories(manufacturer: string): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { controlledCategoryOf } = await import("./category-filter");
  const out = new Set<string>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase
      .from("registry")
      .select("category")
      .eq("manufacturer", manufacturer)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const r of data as Array<{ category: string | null }>) {
      const c = controlledCategoryOf(r.category);
      if (c) out.add(c);
    }
    if (data.length < 1000) break;
  }
  return [...out].sort();
}
