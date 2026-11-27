import type { SupabaseClient } from "@supabase/supabase-js";
import { emailDomain, inviteAutoAccepts, isFreeMailDomain, domainMatches } from "./claim-rules";

// Brand invites (0011 brand_invites). When an invited person signs in:
//   - their email domain is one of the brand's verified domains -> they join
//     the team with the invited role;
//   - otherwise the invite becomes a pending claim for an admin to review.
// Server-only; pass the service client.

export async function acceptInvitesFor(
  service: SupabaseClient,
  user: { id: string; email: string | null }
): Promise<{ joined: string[]; queued: string[] }> {
  const out = { joined: [] as string[], queued: [] as string[] };
  if (!user.email) return out;
  const email = user.email.toLowerCase();

  const { data: invites } = await service
    .from("brand_invites")
    .select("id,org_id,email,role")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .ilike("email", email);
  const rows = (invites ?? []) as Array<{ id: string; org_id: string; email: string; role: "publisher" | "brand-admin" }>;

  for (const inv of rows) {
    if (inv.email.toLowerCase() !== email) continue; // ilike treats _ and % as wildcards
    const { data: org } = await service
      .from("organizations")
      .select("id,name,slug,manufacturer,verified_domains")
      .eq("id", inv.org_id)
      .maybeSingle();
    const o = org as { id: string; name: string; slug: string; manufacturer: string | null; verified_domains: string[] } | null;
    if (!o?.manufacturer) continue;

    const now = new Date().toISOString();
    if (inviteAutoAccepts(email, o.verified_domains)) {
      const { error } = await service
        .from("manufacturer_members")
        .upsert({ user_id: user.id, manufacturer: o.manufacturer, role: inv.role }, { onConflict: "user_id,manufacturer" });
      if (error) continue;
      await service.from("brand_invites").update({ accepted_at: now }).eq("id", inv.id);
      out.joined.push(o.slug);
    } else {
      const domain = emailDomain(email);
      const { error } = await service.from("access_requests").insert({
        user_id: user.id,
        email: user.email,
        manufacturer: o.manufacturer,
        org_id: o.id,
        email_domain: domain,
        domain_match: domainMatches(domain, o.verified_domains),
        note: `Invited by the ${o.name} team.${isFreeMailDomain(domain) ? " Free email provider." : ""}`,
        status: "pending"
      });
      // A duplicate open claim (unique index) still consumes the invite.
      if (error && !/duplicate key/i.test(error.message)) continue;
      await service.from("brand_invites").update({ accepted_at: now }).eq("id", inv.id);
      out.queued.push(o.slug);
    }
  }
  return out;
}
