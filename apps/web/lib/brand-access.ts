import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeManufacturer } from "@opendeviceio/sdk";
import { getCurrentUser, isAdminEmail, type CurrentUser } from "./session";
import { getServiceSupabase } from "./supabase-server";
import { getBrandOrgBySlug, listBrandMembers, type BrandMember, type BrandOrg } from "./brands";

// Who may do what on a brand (claim-your-brand brief, item 7). Server-only.
//   member       any manufacturer_members row for the brand: records, suggestions
//   brand-admin  role 'brand-admin': also team, settings and profile
//   site admin   ADMIN_EMAILS: everything, on every brand

export interface BrandContext {
  user: CurrentUser;
  service: SupabaseClient;
  org: BrandOrg & { manufacturer: string };
  members: BrandMember[];
  myRole: "publisher" | "brand-admin" | null;
  isSiteAdmin: boolean;
  canManage: boolean;
  canAdminister: boolean;
}

export type BrandContextResult =
  | { ok: true; ctx: BrandContext }
  | { ok: false; status: 401 | 403 | 404 | 503; error: string };

export async function loadBrandContext(slug: string): Promise<BrandContextResult> {
  const { user } = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "Sign in to manage a brand." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, status: 503, error: "Brand management isn't configured on this deployment." };

  const org = await getBrandOrgBySlug(service, slug);
  if (!org || !org.manufacturer) return { ok: false, status: 404, error: "Brand not found." };

  const members = await listBrandMembers(service, org.manufacturer);
  const mine = members.find((m) => m.userId === user.id);
  const isSiteAdmin = isAdminEmail(user.email);
  const myRole = mine?.role ?? null;
  const canManage = Boolean(mine) || isSiteAdmin;
  const canAdminister = myRole === "brand-admin" || isSiteAdmin;
  if (!canManage) return { ok: false, status: 403, error: "You're not on this brand's team." };

  return {
    ok: true,
    ctx: {
      user,
      service,
      org: org as BrandOrg & { manufacturer: string },
      members,
      myRole,
      isSiteAdmin,
      canManage,
      canAdminister
    }
  };
}

/** Audit label stored in brand_settings.updated_by: the brand and the member, never an email. */
export function brandActor(ctx: BrandContext): string {
  return ctx.isSiteAdmin && !ctx.myRole
    ? `admin:${ctx.user.id}`
    : `brand:${ctx.org.slug}:${ctx.user.id}`;
}

/** Canonical brand names the user is a member of (service client). */
export async function memberBrands(service: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await service.from("manufacturer_members").select("manufacturer").eq("user_id", userId);
  return ((data ?? []) as Array<{ manufacturer: string }>).map(
    (r) => normalizeManufacturer(r.manufacturer) ?? r.manufacturer
  );
}
