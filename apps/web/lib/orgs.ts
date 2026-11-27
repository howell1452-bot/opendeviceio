import type { SupabaseClient } from "@supabase/supabase-js";

// Design-vendor organizations (0007_provenance_tiers.sql). Server-only: pass
// the service client.

export interface VendorOrg {
  id: string;
  slug: string;
  name: string;
  role: "member" | "admin";
}

/** Verified design-vendor organizations the user belongs to. */
export async function vendorOrgsForUser(
  service: SupabaseClient,
  userId: string
): Promise<VendorOrg[]> {
  const { data: memberships } = await service
    .from("organization_members")
    .select("org_id,role")
    .eq("user_id", userId);
  const rows = (memberships ?? []) as Array<{ org_id: string; role: "member" | "admin" }>;
  if (rows.length === 0) return [];
  const { data: orgs } = await service
    .from("organizations")
    .select("id,slug,name")
    .in(
      "id",
      rows.map((r) => r.org_id)
    )
    .eq("kind", "design-vendor")
    .eq("status", "verified");
  const role = new Map(rows.map((r) => [r.org_id, r.role]));
  return ((orgs ?? []) as Array<{ id: string; slug: string; name: string }>)
    .map((o) => ({ ...o, role: role.get(o.id) ?? "member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Public display names for org ids (verified or not; for admin and record pages). */
export async function orgNames(
  service: SupabaseClient,
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const { data } = await service.from("organizations").select("id,name").in("id", unique);
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]));
}
