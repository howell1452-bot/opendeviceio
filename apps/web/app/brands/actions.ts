"use server";

import { revalidatePath } from "next/cache";
import { normalizeManufacturer } from "@opendeviceio/sdk";
import { getCurrentUser } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase-server";
import { getBrandOrgBySlug, type BrandOrg } from "@/lib/brands";
import { brandActor, loadBrandContext, memberBrands } from "@/lib/brand-access";
import {
  domainMatches,
  emailDomain,
  inviteAutoAccepts,
  isFreeMailDomain,
  leavesNoAdmin,
  type MemberRole
} from "@/lib/claim-rules";
import { manufacturerSlug } from "@/lib/submission-doc";
import { inviteEmail, newClaimEmail, sendEmail } from "@/lib/notify";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, n) : null;
};

// ---------------------------------------------------------------------------
// Claim (item 3)
// ---------------------------------------------------------------------------

/**
 * File a claim for a listed brand (slug) or, for a brand not in the registry
 * yet, by name (creates an unlisted, pending brand profile). The email domain
 * and whether it matches the brand are derived here from the session, never
 * from the form. Every claim waits for an admin.
 */
export async function claimBrand(input: {
  slug?: string;
  newBrandName?: string;
  requesterRole: string;
  note?: string;
}): Promise<Result & { slug?: string }> {
  const { user } = await getCurrentUser();
  if (!user || !user.email) return { ok: false, error: "Sign in with your work email first." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Claims aren't configured on this deployment." };

  const requesterRole = clip(input.requesterRole, 200);
  if (!requesterRole) return { ok: false, error: "Tell us your role at the brand." };

  let org: BrandOrg | null = null;
  if (input.slug) {
    org = await getBrandOrgBySlug(service, input.slug);
    if (!org || org.status === "suspended") return { ok: false, error: "That brand isn't available to claim." };
  } else {
    const raw = clip(input.newBrandName, 200);
    if (!raw) return { ok: false, error: "Pick your brand, or enter its name if it isn't listed." };
    const manufacturer = normalizeManufacturer(raw) ?? raw;
    const { data: existing } = await service
      .from("organizations")
      .select("slug")
      .eq("kind", "manufacturer")
      .eq("manufacturer", manufacturer)
      .maybeSingle();
    if (existing) {
      org = await getBrandOrgBySlug(service, (existing as { slug: string }).slug);
    } else {
      const base = manufacturerSlug(manufacturer) || "brand";
      for (const slug of [base, `${base}-${Math.random().toString(36).slice(2, 7)}`]) {
        const { data: created, error } = await service
          .from("organizations")
          .insert({ kind: "manufacturer", name: manufacturer, slug, manufacturer, status: "pending" })
          .select("slug")
          .maybeSingle();
        if (!error && created) {
          org = await getBrandOrgBySlug(service, (created as { slug: string }).slug);
          break;
        }
      }
    }
    if (!org) return { ok: false, error: "Couldn't record that brand. Try again, or email us." };
  }

  const manufacturer = org.manufacturer ?? org.name;
  if ((await memberBrands(service, user.id)).includes(manufacturer)) {
    return { ok: false, error: `You're already on the ${org.name} team.` };
  }

  const domain = emailDomain(user.email);
  const freeMail = isFreeMailDomain(domain);
  const match = domainMatches(domain, org.verified_domains);

  const { error } = await service.from("access_requests").insert({
    user_id: user.id,
    email: user.email,
    manufacturer,
    org_id: org.id,
    email_domain: domain,
    domain_match: match,
    requester_role: requesterRole,
    note: clip(input.note, 2000),
    status: "pending"
  });
  if (error) {
    if (/duplicate key/i.test(error.message)) {
      return { ok: false, error: `You already have an open claim for ${org.name}.` };
    }
    const m = /^rate_limited:\s*(.*)$/s.exec(error.message);
    return { ok: false, error: m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + "." : error.message };
  }

  await sendEmail(
    newClaimEmail({
      brand: org.name,
      slug: org.slug,
      claimantEmail: user.email,
      domain,
      domainMatch: match,
      freeMail,
      requesterRole
    })
  );
  // No revalidatePath here: re-rendering the claim page would swap the form
  // for its "waiting for review" state before the confirmation shows.
  return { ok: true, slug: org.slug };
}

// ---------------------------------------------------------------------------
// Team (item 7b)
// ---------------------------------------------------------------------------

export async function inviteMember(
  slug: string,
  email: string,
  role: MemberRole
): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  const { ctx } = res;
  if (!ctx.canAdminister) return { ok: false, error: "Only a brand-admin can invite people." };
  if (role !== "publisher" && role !== "brand-admin") return { ok: false, error: "Pick a role." };

  const addr = email.trim().toLowerCase();
  if (!emailDomain(addr)) return { ok: false, error: "Enter a valid email address." };
  if (ctx.members.some((m) => (m.email ?? "").toLowerCase() === addr)) {
    return { ok: false, error: "That person is already on the team." };
  }

  const { error } = await ctx.service.from("brand_invites").insert({
    org_id: ctx.org.id,
    email: addr,
    role,
    invited_by: ctx.user.id
  });
  if (error) {
    return {
      ok: false,
      error: /duplicate key/i.test(error.message) ? "That email already has an open invite." : error.message
    };
  }
  const autoAccept = inviteAutoAccepts(addr, ctx.org.verified_domains);
  await sendEmail(inviteEmail({ to: addr, brand: ctx.org.name, slug: ctx.org.slug, autoAccept }));
  revalidatePath(`/brands/${slug}/manage`);
  return {
    ok: true,
    message: autoAccept
      ? "Invited. They'll join the team when they sign in."
      : "Invited. Their email domain isn't verified for this brand, so an admin reviews it when they sign in."
  };
}

export async function revokeInvite(slug: string, inviteId: string): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.ctx.canAdminister) return { ok: false, error: "Only a brand-admin can revoke invites." };
  const { error } = await res.ctx.service
    .from("brand_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("org_id", res.ctx.org.id)
    .is("accepted_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}/manage`);
  return { ok: true };
}

export async function setMemberRole(slug: string, userId: string, role: MemberRole): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  const { ctx } = res;
  if (!ctx.canAdminister) return { ok: false, error: "Only a brand-admin can change roles." };
  if (role !== "publisher" && role !== "brand-admin") return { ok: false, error: "Pick a role." };
  if (!ctx.members.some((m) => m.userId === userId)) return { ok: false, error: "Not a team member." };
  if (leavesNoAdmin(ctx.members, { userId, role })) {
    return { ok: false, error: "A brand needs at least one brand-admin. Make someone else a brand-admin first." };
  }
  const { error } = await ctx.service
    .from("manufacturer_members")
    .update({ role })
    .eq("user_id", userId)
    .eq("manufacturer", ctx.org.manufacturer);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}/manage`);
  return { ok: true };
}

export async function removeMember(slug: string, userId: string): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  const { ctx } = res;
  if (!ctx.canAdminister) return { ok: false, error: "Only a brand-admin can remove people." };
  if (!ctx.members.some((m) => m.userId === userId)) return { ok: false, error: "Not a team member." };
  if (leavesNoAdmin(ctx.members, { userId, remove: true })) {
    return { ok: false, error: "A brand needs at least one brand-admin. Make someone else a brand-admin first." };
  }
  const { error } = await ctx.service
    .from("manufacturer_members")
    .delete()
    .eq("user_id", userId)
    .eq("manufacturer", ctx.org.manufacturer);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}/manage`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings (item 7c)
// ---------------------------------------------------------------------------

/**
 * The brand-controlled "hide unverified drafts" switch. Uses the admin
 * function from 0006 without publishing removals to the feed (that stays an
 * OpenDeviceIO decision).
 */
export async function setHideDrafts(slug: string, hidden: boolean): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  const { ctx } = res;
  if (!ctx.canAdminister) return { ok: false, error: "Only a brand-admin can change settings." };
  const { error } = await ctx.service.rpc("admin_set_brand_hidden", {
    p_manufacturer: ctx.org.manufacturer,
    p_hidden: hidden,
    p_publish_removals: false,
    p_note: null,
    p_actor: brandActor(ctx)
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}/manage`);
  revalidatePath(`/brands/${slug}`);
  return { ok: true };
}

export async function setCommunitySubmissions(
  slug: string,
  value: "allowed" | "suggestions-only" | "blocked"
): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  const { ctx } = res;
  if (!ctx.canAdminister) return { ok: false, error: "Only a brand-admin can change settings." };
  if (!["allowed", "suggestions-only", "blocked"].includes(value)) return { ok: false, error: "Pick a setting." };
  const { data: existing } = await ctx.service
    .from("brand_settings")
    .select("manufacturer")
    .eq("manufacturer", ctx.org.manufacturer)
    .maybeSingle();
  const now = new Date().toISOString();
  const { error } = existing
    ? await ctx.service
        .from("brand_settings")
        .update({ community_submissions: value, updated_by: brandActor(ctx), updated_at: now })
        .eq("manufacturer", ctx.org.manufacturer)
    : await ctx.service.from("brand_settings").insert({
        manufacturer: ctx.org.manufacturer,
        community_submissions: value,
        updated_by: brandActor(ctx),
        updated_at: now
      });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}/manage`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Profile (item 7d)
// ---------------------------------------------------------------------------

const httpUrl = (v: string | null) => (v === null || /^https?:\/\/[^\s]+$/i.test(v) ? v : undefined);

export async function updateBrandProfile(
  slug: string,
  input: { description: string; website: string; supportUrl: string; dataContact: string }
): Promise<Result> {
  const res = await loadBrandContext(slug);
  if (!res.ok) return { ok: false, error: res.error };
  const { ctx } = res;
  if (!ctx.canAdminister) return { ok: false, error: "Only a brand-admin can edit the profile." };

  const description = clip(input.description, 600);
  if ((input.description ?? "").trim().length > 600) {
    return { ok: false, error: "Keep the description to 600 characters." };
  }
  const website = httpUrl(clip(input.website, 500));
  const supportUrl = httpUrl(clip(input.supportUrl, 500));
  if (website === undefined || supportUrl === undefined) {
    return { ok: false, error: "Links must start with https:// (or http://)." };
  }
  const dataContact = clip(input.dataContact, 200);

  const { error } = await ctx.service
    .from("organizations")
    .update({ description, website, support_url: supportUrl, data_contact: dataContact })
    .eq("id", ctx.org.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}`);
  revalidatePath(`/brands/${slug}/manage`);
  return { ok: true };
}
