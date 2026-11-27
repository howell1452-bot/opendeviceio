import type { SupabaseClient } from "@supabase/supabase-js";
import { isFreeMailDomain, suggestAddDomain } from "./claim-rules";
import type { AdminClaim } from "@/app/admin/ClaimRow";

// Pending brand claims for /admin, with the brand profile and its current
// team. Server-only (service client); emails are shown to admins only.

export async function loadAdminClaims(service: SupabaseClient): Promise<AdminClaim[]> {
  const { data, error } = await service
    .from("access_requests")
    .select("id,user_id,email,manufacturer,note,requester_role,created_at,org_id,email_domain,domain_match")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    email: string | null;
    manufacturer: string;
    note: string | null;
    requester_role: string | null;
    created_at: string | null;
    org_id: string | null;
    email_domain: string | null;
    domain_match: boolean | null;
  }>;

  const orgIds = [...new Set(rows.map((r) => r.org_id).filter((x): x is string => Boolean(x)))];
  const { data: orgData } = orgIds.length
    ? await service
        .from("organizations")
        .select("id,name,slug,status,claimed_at,manufacturer,verified_domains")
        .in("id", orgIds)
    : { data: [] };
  const orgs = new Map(
    ((orgData ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      status: string;
      claimed_at: string | null;
      manufacturer: string | null;
      verified_domains: string[];
    }>).map((o) => [o.id, o])
  );

  const brands = [...new Set(rows.map((r) => (r.org_id ? orgs.get(r.org_id)?.manufacturer : null) ?? r.manufacturer))];
  const { data: memberData } = brands.length
    ? await service.from("manufacturer_members").select("user_id,manufacturer,role").in("manufacturer", brands)
    : { data: [] };
  const memberRows = (memberData ?? []) as Array<{ user_id: string; manufacturer: string; role: string }>;
  const emails = new Map<string, string | null>();
  await Promise.all(
    [...new Set(memberRows.map((m) => m.user_id))].map(async (uid) => {
      try {
        const { data: u } = await service.auth.admin.getUserById(uid);
        emails.set(uid, u?.user?.email ?? null);
      } catch {
        emails.set(uid, null);
      }
    })
  );

  return rows.map((r) => {
    const org = r.org_id ? orgs.get(r.org_id) : undefined;
    const brand = org?.manufacturer ?? r.manufacturer;
    return {
      id: r.id,
      email: r.email,
      manufacturer: r.manufacturer,
      note: r.note,
      requesterRole: r.requester_role,
      createdAt: r.created_at,
      emailDomain: r.email_domain,
      domainMatch: r.domain_match,
      freeMail: isFreeMailDomain(r.email_domain),
      suggestAddDomain: suggestAddDomain(r.email_domain) && !r.domain_match,
      org: org
        ? {
            name: org.name,
            slug: org.slug,
            status: org.status,
            claimed: Boolean(org.claimed_at),
            verifiedDomains: org.verified_domains ?? []
          }
        : null,
      members: memberRows
        .filter((m) => m.manufacturer === brand)
        .map((m) => ({ email: emails.get(m.user_id) ?? null, role: m.role }))
    };
  });
}
