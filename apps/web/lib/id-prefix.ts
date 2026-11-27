import type { SupabaseClient } from "@supabase/supabase-js";
import { brandSlug, checkIdPrefix, normalizeManufacturer, type IdPrefixMismatch } from "@opendeviceio/sdk";

// A record id's prefix must be its manufacturer's brand slug (registry paging
// and ID cleanup brief, item 4). The stored organizations.slug is the
// authority (the database trigger compares with it); a brand without a profile
// yet gets the slug the database would give it.

/** The brand slug for a manufacturer: its stored profile slug, or brandSlug of the canonical name. */
export async function brandSlugFor(service: SupabaseClient, manufacturer: string): Promise<string> {
  const canonical = normalizeManufacturer(manufacturer) ?? manufacturer;
  const { data } = await service
    .from("organizations")
    .select("slug")
    .eq("kind", "manufacturer")
    .eq("manufacturer", canonical)
    .maybeSingle();
  return (data as { slug: string } | null)?.slug ?? brandSlug(canonical);
}

/** Null when `id` sits under the manufacturer's brand slug; otherwise what's wrong. */
export async function idPrefixProblem(
  service: SupabaseClient,
  id: string,
  manufacturer: string
): Promise<IdPrefixMismatch | null> {
  return checkIdPrefix(id, manufacturer, await brandSlugFor(service, manufacturer));
}

/** "id prefix 'qsys' doesn't match brand slug 'qsc'. Use the id "qsc/core-610"." */
export function idPrefixErrorMessage(m: IdPrefixMismatch): string {
  return `${m.message}. Use the id "${m.suggestedId}".`;
}
