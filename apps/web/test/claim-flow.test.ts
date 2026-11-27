// Claim-your-brand server code end to end (brief items 3, 4 and 7) against an
// in-memory stand-in for the Supabase client. Database rules (no client
// inserts, RLS, the rate-limit trigger) are tested on real Postgres in
// supabase/tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";

const state: {
  db: FakeDb;
  user: { id: string; email: string } | null;
  admins: string[];
  sent: Array<{ to: string; subject: string; text: string }>;
} = { db: new FakeDb(), user: null, admins: [], sent: [] };

vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    user: state.user ? { id: state.user.id, email: state.user.email } : null,
    client: state.user ? state.db.client() : null
  }),
  isAdminEmail: (email: string | null | undefined) => Boolean(email && state.admins.includes(email))
}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceSupabase: () => state.db.client(),
  getServerSupabase: async () => state.db.client(),
  supabaseConfigured: () => true
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  sendEmail: async (e: { to: string; subject: string; text: string }) => {
    state.sent.push(e);
    return { sent: true };
  }
}));

const brandActions = await import("../app/brands/actions");
const adminActions = await import("../app/admin/actions");
const { acceptInvitesFor } = await import("../lib/invites");
const { loadBrandContext } = await import("../lib/brand-access");

const REP = { id: "aaaa0000-0000-4000-8000-000000000001", email: "rep@acme.example" };
const REP2 = { id: "aaaa0000-0000-4000-8000-000000000002", email: "pm@acme.example" };
const GMAIL = { id: "aaaa0000-0000-4000-8000-000000000003", email: "someone@gmail.com" };
const ADMIN = { id: "aaaa0000-0000-4000-8000-0000000000ad", email: "admin@opendeviceio.example" };
const COLLEAGUE = { id: "aaaa0000-0000-4000-8000-000000000004", email: "colleague@acme.example" };
const OUTSIDER = { id: "aaaa0000-0000-4000-8000-000000000005", email: "pat@agency.example" };

function seedBrand(over: Record<string, unknown> = {}) {
  state.db.t("organizations").push({
    id: "0rg00000-0000-4000-8000-000000000001",
    kind: "manufacturer",
    name: "Acme Devices",
    slug: "acme-devices",
    manufacturer: "Acme Devices",
    status: "verified",
    claimed_at: null,
    verified_domains: [],
    description: null,
    website: null,
    support_url: null,
    data_contact: null,
    ...over
  });
}
const org = () => state.db.t("organizations").find((o) => o.slug === "acme-devices")!;
const claims = () => state.db.t("access_requests");
const members = () => state.db.t("manufacturer_members");

async function claimAs(user: typeof REP, extra: Record<string, unknown> = {}) {
  state.user = user;
  return brandActions.claimBrand({ slug: "acme-devices", requesterRole: "Product manager", ...extra });
}

async function approveAs(id: string, addDomain = true) {
  state.user = ADMIN;
  return adminActions.approveRequest(id, { addDomain });
}

beforeEach(() => {
  state.db = new FakeDb({ users: { [REP.id]: REP.email, [REP2.id]: REP2.email, [COLLEAGUE.id]: COLLEAGUE.email } });
  state.user = null;
  state.admins = [ADMIN.email];
  state.sent = [];
  seedBrand();
});

describe("claim (item 3)", () => {
  it("needs a signed-in user", async () => {
    const res = await brandActions.claimBrand({ slug: "acme-devices", requesterRole: "PM" });
    expect(res).toMatchObject({ ok: false });
  });

  it("files a claim with the server-derived email domain and alerts the admins", async () => {
    const res = await claimAs(REP, { note: "Team page: acme.example/team" });
    expect(res).toMatchObject({ ok: true, slug: "acme-devices" });
    expect(claims()[0]).toMatchObject({
      user_id: REP.id,
      org_id: org().id,
      manufacturer: "Acme Devices",
      email_domain: "acme.example",
      domain_match: false,
      requester_role: "Product manager",
      status: "pending"
    });
    expect(state.sent[0].subject).toBe("Brand claim: Acme Devices");
    expect(state.sent[0].text).toContain("acme.example");
  });

  it("matches the domain once it's verified for the brand", async () => {
    org().verified_domains = ["acme.example"];
    await claimAs(REP);
    expect(claims()[0].domain_match).toBe(true);
  });

  it("flags free-mail claims and never matches them", async () => {
    org().verified_domains = ["gmail.com"];
    await claimAs(GMAIL);
    expect(claims()[0]).toMatchObject({ email_domain: "gmail.com", domain_match: false });
    expect(state.sent[0].text).toContain("WARNING: free email provider");
  });

  it("reports a duplicate open claim and the rate limit in plain words", async () => {
    state.db.opts.beforeInsert = (t) =>
      t === "access_requests" ? 'duplicate key value violates unique constraint "access_requests_one_open_claim"' : null;
    expect(await claimAs(REP)).toEqual({ ok: false, error: "You already have an open claim for Acme Devices." });
    state.db.opts.beforeInsert = (t) =>
      t === "access_requests" ? "rate_limited: you can file 5 brand claims per day; try again tomorrow" : null;
    expect(await claimAs(REP)).toEqual({ ok: false, error: "You can file 5 brand claims per day; try again tomorrow." });
  });

  it("creates an unlisted (pending) brand profile for a brand not in the registry", async () => {
    state.user = REP;
    const res = await brandActions.claimBrand({ newBrandName: "Brand New Audio", requesterRole: "CTO" });
    expect(res).toMatchObject({ ok: true, slug: "brand-new-audio" });
    const created = state.db.t("organizations").find((o) => o.slug === "brand-new-audio")!;
    expect(created).toMatchObject({ kind: "manufacturer", status: "pending", manufacturer: "Brand New Audio" });
    expect(claims()[0].org_id).toBe(created.id);
  });

  it("won't claim a brand you're already on", async () => {
    members().push({ user_id: REP.id, manufacturer: "Acme Devices", role: "brand-admin" });
    expect(await claimAs(REP)).toMatchObject({ ok: false, error: "You're already on the Acme Devices team." });
  });
});

describe("admin approval (item 4)", () => {
  it("approves in one call: brand-admin for the first member, claimed, domain verified, claimant emailed", async () => {
    await claimAs(REP);
    state.sent = [];
    const res = await approveAs(String(claims()[0].id));
    expect(res).toEqual({ ok: true, role: "brand-admin" });
    expect(members()).toEqual([
      expect.objectContaining({ user_id: REP.id, manufacturer: "Acme Devices", role: "brand-admin", created_by: ADMIN.id })
    ]);
    expect(org().claimed_at).toBeTruthy();
    expect(org().verified_domains).toEqual(["acme.example"]);
    expect(claims()[0]).toMatchObject({ status: "approved", decided_by: ADMIN.id });
    expect(claims()[0].decided_at).toBeTruthy();
    expect(state.sent).toEqual([
      expect.objectContaining({ to: REP.email, subject: "You can now manage Acme Devices on OpenDeviceIO" })
    ]);
  });

  it("later members are publishers, and claimed_at is kept", async () => {
    await claimAs(REP);
    await approveAs(String(claims()[0].id));
    const firstClaimedAt = org().claimed_at;
    await claimAs(REP2);
    expect(await approveAs(String(claims()[1].id))).toEqual({ ok: true, role: "publisher" });
    expect(org().claimed_at).toBe(firstClaimedAt);
  });

  it("never adds a free-mail domain to the brand", async () => {
    await claimAs(GMAIL);
    await approveAs(String(claims()[0].id), true);
    expect(org().verified_domains).toEqual([]);
  });

  it("lists a new brand when its claim is approved", async () => {
    state.user = REP;
    await brandActions.claimBrand({ newBrandName: "Brand New Audio", requesterRole: "CTO" });
    await approveAs(String(claims()[0].id));
    expect(state.db.t("organizations").find((o) => o.slug === "brand-new-audio")).toMatchObject({ status: "verified" });
  });

  it("rejects with a note and tells the claimant", async () => {
    await claimAs(REP);
    state.sent = [];
    state.user = ADMIN;
    expect(await adminActions.rejectRequest(String(claims()[0].id), "Please use your work email")).toEqual({ ok: true });
    expect(claims()[0]).toMatchObject({ status: "rejected", decision_note: "Please use your work email", decided_by: ADMIN.id });
    expect(state.sent[0]).toMatchObject({ to: REP.email });
    expect(state.sent[0].text).toContain("Please use your work email");
  });

  it("only admins can decide", async () => {
    await claimAs(REP);
    state.user = REP2;
    expect(await adminActions.approveRequest(String(claims()[0].id))).toMatchObject({ ok: false, error: "Not authorized." });
    expect(members()).toHaveLength(0);
  });
});

describe("brand dashboard (item 7)", () => {
  async function claimedByRep() {
    await claimAs(REP);
    await approveAs(String(claims()[0].id)); // REP is brand-admin; acme.example verified
  }

  it("is for the team and site admins only", async () => {
    await claimedByRep();
    state.user = OUTSIDER;
    expect(await loadBrandContext("acme-devices")).toMatchObject({ ok: false, status: 403 });
    state.user = ADMIN;
    expect(await loadBrandContext("acme-devices")).toMatchObject({ ok: true });
    state.user = null;
    expect(await loadBrandContext("acme-devices")).toMatchObject({ ok: false, status: 401 });
  });

  it("invites a colleague at a verified domain, who joins on sign-in", async () => {
    await claimedByRep();
    state.user = REP;
    const res = await brandActions.inviteMember("acme-devices", "Colleague@Acme.example", "publisher");
    expect(res).toMatchObject({ ok: true, message: "Invited. They'll join the team when they sign in." });
    const joined = await acceptInvitesFor(state.db.client(), COLLEAGUE);
    expect(joined).toEqual({ joined: ["acme-devices"], queued: [] });
    expect(members().find((m) => m.user_id === COLLEAGUE.id)).toMatchObject({ role: "publisher" });
    expect(state.db.t("brand_invites")[0].accepted_at).toBeTruthy();
  });

  it("sends anyone else to admin review instead of letting them in", async () => {
    await claimedByRep();
    state.user = REP;
    await brandActions.inviteMember("acme-devices", OUTSIDER.email, "brand-admin");
    const out = await acceptInvitesFor(state.db.client(), OUTSIDER);
    expect(out).toEqual({ joined: [], queued: ["acme-devices"] });
    expect(members().some((m) => m.user_id === OUTSIDER.id)).toBe(false);
    expect(claims().find((c) => c.user_id === OUTSIDER.id)).toMatchObject({ status: "pending", domain_match: false });
  });

  it("publishers can't manage the team; the last brand-admin can't be removed or demoted", async () => {
    await claimedByRep();
    await claimAs(REP2);
    await approveAs(String(claims()[1].id)); // REP2 publisher
    state.user = REP2;
    expect(await brandActions.inviteMember("acme-devices", "x@acme.example", "publisher")).toMatchObject({ ok: false });
    state.user = REP;
    expect(await brandActions.removeMember("acme-devices", REP.id)).toMatchObject({ ok: false });
    expect(await brandActions.setMemberRole("acme-devices", REP.id, "publisher")).toMatchObject({ ok: false });
    expect(await brandActions.setMemberRole("acme-devices", REP2.id, "brand-admin")).toEqual({ ok: true });
    expect(await brandActions.setMemberRole("acme-devices", REP.id, "publisher")).toEqual({ ok: true });
    state.user = REP2;
    expect(await brandActions.removeMember("acme-devices", REP.id)).toEqual({ ok: true });
    expect(members().map((m) => m.user_id)).toEqual([REP2.id]);
  });

  it("hides drafts through the 0006 admin function without publishing removals", async () => {
    await claimedByRep();
    state.user = REP;
    expect(await brandActions.setHideDrafts("acme-devices", true)).toEqual({ ok: true });
    expect(state.db.rpcCalls).toEqual([
      {
        name: "admin_set_brand_hidden",
        args: expect.objectContaining({
          p_manufacturer: "Acme Devices",
          p_hidden: true,
          p_publish_removals: false,
          p_actor: `brand:acme-devices:${REP.id}`
        })
      }
    ]);
  });

  it("sets community submissions, with an audit label instead of an email", async () => {
    await claimedByRep();
    state.user = REP;
    expect(await brandActions.setCommunitySubmissions("acme-devices", "suggestions-only")).toEqual({ ok: true });
    expect(state.db.t("brand_settings")[0]).toMatchObject({
      manufacturer: "Acme Devices",
      community_submissions: "suggestions-only",
      updated_by: `brand:acme-devices:${REP.id}`
    });
  });

  it("edits the profile, validating links and length", async () => {
    await claimedByRep();
    state.user = REP;
    const base = { description: "Acme makes devices.", website: "https://acme.example", supportUrl: "", dataContact: "" };
    expect(await brandActions.updateBrandProfile("acme-devices", { ...base, website: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(await brandActions.updateBrandProfile("acme-devices", { ...base, description: "x".repeat(601) })).toMatchObject({ ok: false });
    expect(await brandActions.updateBrandProfile("acme-devices", { ...base, dataContact: "productdata@acme.example" })).toEqual({ ok: true });
    expect(org()).toMatchObject({
      description: "Acme makes devices.",
      website: "https://acme.example",
      support_url: null,
      data_contact: "productdata@acme.example"
    });
  });
});
