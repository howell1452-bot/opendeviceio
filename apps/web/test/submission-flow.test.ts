// End-to-end over the server code paths: POST /api/v1/submissions, the admin
// queue actions, the brand's accept / decline actions and manufacturer
// publishes, against an in-memory stand-in for the Supabase client.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";

const state: {
  db: FakeDb;
  caller: { userId: string; email: string } | null;
  admin: boolean;
} = { db: new FakeDb(), caller: null, admin: false };

vi.mock("@/lib/server-auth", () => ({
  resolveCaller: async () =>
    state.caller
      ? { ok: true, service: state.db.client(), caller: { ...state.caller, via: "token", tokenId: "t1" } }
      : { ok: false, status: 401, error: "Authentication required." },
  touchToken: async () => undefined
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    user: state.caller ? { id: state.caller.userId, email: state.caller.email } : null,
    client: state.caller ? state.db.client() : null
  }),
  isAdminEmail: () => state.admin
}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceSupabase: () => state.db.client(),
  getServerSupabase: async () => state.db.client(),
  supabaseConfigured: () => true
}));

const { POST: submit } = await import("../app/api/v1/submissions/route");
const { POST: publish } = await import("../app/api/v1/devices/route");
const admin = await import("../app/admin/actions");
const brand = await import("../app/account/actions");
const { CONTRIBUTOR_TERMS_VERSION } = await import("../lib/data-license");

const ALICE = { userId: "a11ce000-0000-4000-8000-000000000001", email: "alice@example.com" };
const BOB = { userId: "b0b00000-0000-4000-8000-000000000002", email: "bob@example.com" };
const EXTRON_REP = { userId: "e0000000-0000-4000-8000-000000000003", email: "rep@extron.example" };
const ADMIN = { userId: "ad000000-0000-4000-8000-000000000004", email: "admin@example.org" };

const EXAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../examples/extron-dtp2-t-211.odio", import.meta.url)), "utf8")
) as Record<string, unknown> & { id: string };

function doc(over: Record<string, unknown> = {}) {
  return { ...JSON.parse(JSON.stringify(EXAMPLE)), ...over } as Record<string, unknown> & { id: string };
}

function claimingVerified() {
  const d = doc();
  d.provenance = {
    ...(d.provenance as object),
    validation: { status: "manufacturer-verified", by: "Extron", date: "2026-01-01" }
  };
  return d;
}

async function send(body: unknown, init: { raw?: string; headers?: Record<string, string> } = {}) {
  const res = await submit(
    new Request("https://opendeviceio.org/api/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.raw ?? JSON.stringify(body)
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const envelope = (document: unknown, extra: Record<string, unknown> = {}) => ({
  document,
  accept_terms: CONTRIBUTOR_TERMS_VERSION,
  ...extra
});

function registryRow(id: string) {
  return state.db.t("registry").find((r) => r.id === id) as Record<string, unknown> | undefined;
}
function revision(id: string) {
  return state.db.t("record_revisions").find((r) => r.id === id) as Record<string, unknown>;
}

/** Seed a machine-draft row with its backfilled published revision. */
function seedDraft(d = doc(), over: Record<string, unknown> = {}) {
  const revId = `5eed0000-0000-4000-8000-${String(state.db.t("record_revisions").length).padStart(12, "0")}`;
  state.db.t("record_revisions").push({
    id: revId,
    record_id: d.id,
    document: d,
    manufacturer: "Extron",
    source_type: "machine-draft",
    source_org_id: null,
    submitted_by: null,
    status: "published",
    created_at: "2026-01-01T00:00:00Z",
    reviewed_at: null
  });
  state.db.t("registry").push({
    id: d.id,
    kind: "device",
    manufacturer: "Extron",
    model: "DTP2 T 211",
    validation_status: "draft",
    source_type: "machine-draft",
    source_org_id: null,
    current_revision_id: revId,
    document: d,
    updated_at: "2026-01-01T00:00:00Z",
    ...over
  });
  return revId;
}

beforeEach(() => {
  state.db = new FakeDb({ users: { [ALICE.userId]: ALICE.email, [BOB.userId]: BOB.email } });
  state.caller = null;
  state.admin = false;
  state.db.t("manufacturer_members").push({ user_id: EXTRON_REP.userId, manufacturer: "Extron" });
});

describe("POST /api/v1/submissions: input checks", () => {
  it("401 when not signed in", async () => {
    const r = await send(envelope(doc()));
    expect(r.status).toBe(401);
  });

  it("400 with schema errors in the same {error, details} shape as POST /devices", async () => {
    state.caller = ALICE;
    const bad = doc();
    delete (bad as Record<string, unknown>).device;
    const r = await send(envelope(bad));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Document failed ODIO schema validation.");
    expect(Array.isArray(r.body.details)).toBe(true);
    expect((r.body.details as string[]).length).toBeGreaterThan(0);
  });

  it("400 without accepting the contributor terms", async () => {
    state.caller = ALICE;
    const r = await send({ document: doc() });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain(CONTRIBUTOR_TERMS_VERSION);
  });

  it("413 above 512 KB", async () => {
    state.caller = ALICE;
    const big = JSON.stringify(envelope(doc({ "x-pad": "x".repeat(600 * 1024) })));
    const r = await send(null, { raw: big });
    expect(r.status).toBe(413);
  });

  it("400 when a new id's prefix doesn't match the manufacturer", async () => {
    state.caller = ALICE;
    const r = await send(envelope(doc({ id: "crestron/dtp2-t-211" })));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('"extron/');
  });

  it("400 when an existing id belongs to another manufacturer", async () => {
    state.caller = ALICE;
    seedDraft(doc(), { manufacturer: "Crestron" });
    const r = await send(envelope(doc()));
    expect(r.status).toBe(400);
  });

  it("points a brand member at /publish for their own brand", async () => {
    state.caller = EXTRON_REP;
    const r = await send(envelope(doc()));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("/publish");
  });

  it("403 for a suspended user", async () => {
    state.caller = ALICE;
    state.db.t("contributor_status").push({ user_id: ALICE.userId, suspended: true, trusted: false, accepted_count: 0 });
    const r = await send(envelope(doc()));
    expect(r.status).toBe(403);
  });

  it("403 when the brand blocks community submissions", async () => {
    state.caller = ALICE;
    state.db.t("brand_settings").push({ manufacturer: "Extron", community_submissions: "blocked", hidden_until_opt_in: false });
    const r = await send(envelope(doc()));
    expect(r.status).toBe(403);
    expect(String(r.body.error)).toContain("maintains its own records");
  });

  it("429 with the trigger's message when rate limited", async () => {
    state.caller = ALICE;
    state.db.opts.beforeInsert = (table) =>
      table === "record_revisions" ? "rate_limited: you can submit 20 records per hour; try again later" : null;
    const r = await send(envelope(doc()));
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("You can submit 20 records per hour; try again later.");
  });
});

describe("submission -> moderation -> API", () => {
  it("a file claiming manufacturer-verified is stored as an unverified draft, then published by an admin as community", async () => {
    state.caller = ALICE;
    const r = await send(envelope(claimingVerified(), { change_note: "From the spec sheet." }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ record_id: EXAMPLE.id, status: "pending", source_type: "community" });

    const rev = revision(String(r.body.revision_id));
    expect((rev.document as { provenance: { validation: unknown } }).provenance.validation).toEqual({ status: "draft" });
    expect(rev.is_new_record).toBe(true);
    expect(rev.terms_version).toBe(CONTRIBUTOR_TERMS_VERSION);
    expect(registryRow(EXAMPLE.id)).toBeUndefined(); // nothing public yet

    state.caller = ADMIN;
    state.admin = true;
    const pub = await admin.publishSubmission(String(r.body.revision_id));
    expect(pub).toEqual({ ok: true });

    const row = registryRow(EXAMPLE.id)!;
    expect(row.source_type).toBe("community");
    expect(row.validation_status).toBe("draft");
    expect(row.current_revision_id).toBe(r.body.revision_id);
    expect((row.document as { provenance: { validation: unknown } }).provenance.validation).toEqual({ status: "draft" });
    expect(revision(String(r.body.revision_id))).toMatchObject({ status: "published", reviewer: "OpenDeviceIO" });
    expect(state.db.t("contributor_status").find((c) => c.user_id === ALICE.userId)).toMatchObject({ accepted_count: 1 });
  });

  it("an admin can reject with a note, and can suspend a submitter", async () => {
    state.caller = ALICE;
    const one = await send(envelope(doc()));
    const two = await send(envelope(doc({ id: "extron/other-one" })));
    state.caller = ADMIN;
    state.admin = true;
    expect(await admin.rejectSubmission(String(one.body.revision_id), "Duplicate")).toEqual({ ok: true });
    expect(revision(String(one.body.revision_id))).toMatchObject({ status: "rejected", review_note: "Duplicate" });
    const sus = await admin.suspendSubmitter(String(two.body.revision_id), "spam");
    expect(sus).toMatchObject({ ok: true, rejected: 1 });
    expect(state.db.t("contributor_status").find((c) => c.user_id === ALICE.userId)).toMatchObject({ suspended: true });
  });

  it("admin actions require an admin", async () => {
    state.caller = BOB;
    expect(await admin.publishSubmission("x")).toMatchObject({ ok: false, error: "Not authorized." });
  });

  it("a trusted contributor's new record publishes directly", async () => {
    state.caller = ALICE;
    state.db.t("contributor_status").push({ user_id: ALICE.userId, trusted: true, suspended: false, accepted_count: 3 });
    const r = await send(envelope(doc()));
    expect(r.body.status).toBe("published");
    expect(registryRow(EXAMPLE.id)).toMatchObject({ source_type: "community", validation_status: "draft" });
  });

  it("an untrusted user's edit to a machine draft waits for review; the draft is untouched", async () => {
    const seededRev = seedDraft();
    const before = JSON.stringify(registryRow(EXAMPLE.id));
    state.caller = ALICE;
    const r = await send(envelope(doc({ "x-note": "edit" })));
    expect(r.body.status).toBe("pending");
    expect(revision(String(r.body.revision_id)).base_revision_id).toBe(seededRev);
    expect(JSON.stringify(registryRow(EXAMPLE.id))).toBe(before);
  });

  it("removed-on-request ids become suggestions", async () => {
    state.caller = ALICE;
    state.db.t("contributor_status").push({ user_id: ALICE.userId, trusted: true, suspended: false, accepted_count: 3 });
    state.db.t("registry_removals").push({ seq: 1, id: EXAMPLE.id, reason: "Removed on request" });
    const r = await send(envelope(doc()));
    expect(r.body.status).toBe("suggested");
    expect(registryRow(EXAMPLE.id)).toBeUndefined();
  });

  it("suggestions-only brands always get suggestions", async () => {
    state.caller = ALICE;
    state.db.t("contributor_status").push({ user_id: ALICE.userId, trusted: true, suspended: false, accepted_count: 3 });
    state.db.t("brand_settings").push({ manufacturer: "Extron", community_submissions: "suggestions-only", hidden_until_opt_in: false });
    const r = await send(envelope(doc()));
    expect(r.body.status).toBe("suggested");
  });

  it("auto-trust after 3 accepted with none rejected", async () => {
    state.admin = true;
    for (let i = 0; i < 3; i++) {
      state.caller = ALICE;
      const r = await send(envelope(doc({ id: `extron/model-${i}` })));
      expect(r.body.status).toBe("pending");
      state.caller = ADMIN;
      expect(await admin.publishSubmission(String(r.body.revision_id))).toEqual({ ok: true });
    }
    expect(state.db.t("contributor_status").find((c) => c.user_id === ALICE.userId)).toMatchObject({
      accepted_count: 3,
      trusted: true
    });
    state.caller = ALICE;
    const next = await send(envelope(doc({ id: "extron/model-9" })));
    expect(next.body.status).toBe("published");
  });
});

describe("verified records", () => {
  async function verifiedRecord() {
    seedDraft();
    state.caller = EXTRON_REP;
    const res = await publish(
      new Request("https://opendeviceio.org/api/v1/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc())
      })
    );
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; status: string; revision_id: string };
  }

  it("a manufacturer publish creates a revision and supersedes the previous one", async () => {
    const out = await verifiedRecord();
    const seeded = state.db.t("record_revisions").find((r) => r.source_type === "machine-draft")!.id;
    expect(out.status).toBe("manufacturer-verified");
    expect(registryRow(EXAMPLE.id)).toMatchObject({
      validation_status: "manufacturer-verified",
      source_type: "manufacturer",
      current_revision_id: out.revision_id
    });
    expect(revision(String(seeded)).status).toBe("superseded");
    expect(revision(out.revision_id).status).toBe("published");
  });

  it("a community upload against a verified record never changes the registry row", async () => {
    await verifiedRecord();
    const before = JSON.stringify(registryRow(EXAMPLE.id));
    state.caller = ALICE;
    state.db.t("contributor_status").push({ user_id: ALICE.userId, trusted: true, suspended: false, accepted_count: 9 });
    const r = await send(envelope(claimingVerified()));
    expect(r.body.status).toBe("suggested");
    expect(JSON.stringify(registryRow(EXAMPLE.id))).toBe(before);

    // Admins can't publish it over the verified record either.
    state.caller = ADMIN;
    state.admin = true;
    const pub = await admin.publishSubmission(String(r.body.revision_id));
    expect(pub.ok).toBe(false);
    expect(JSON.stringify(registryRow(EXAMPLE.id))).toBe(before);
  });

  it("the brand accepts a suggestion: re-published as manufacturer-verified, submitter credited", async () => {
    await verifiedRecord();
    state.caller = ALICE;
    const r = await send(envelope(doc({ "x-fix": "port 2 is Dante" })));
    expect(r.body.status).toBe("suggested");

    state.caller = BOB; // not a member
    expect((await brand.acceptSuggestion(String(r.body.revision_id))).ok).toBe(false);

    state.caller = EXTRON_REP;
    const acc = await brand.acceptSuggestion(String(r.body.revision_id));
    expect(acc).toEqual({ ok: true, id: EXAMPLE.id });
    const row = registryRow(EXAMPLE.id)!;
    expect(row).toMatchObject({ validation_status: "manufacturer-verified", source_type: "manufacturer" });
    expect((row.document as Record<string, unknown>)["x-fix"]).toBe("port 2 is Dante");
    expect(revision(String(r.body.revision_id))).toMatchObject({ status: "accepted", reviewer: "Extron" });
    expect(state.db.t("contributor_status").find((c) => c.user_id === ALICE.userId)).toMatchObject({ accepted_count: 1 });
  });

  it("the brand declines a suggestion; a later manufacturer publish leaves other suggestions open", async () => {
    await verifiedRecord();
    state.caller = ALICE;
    const one = await send(envelope(doc({ "x-a": 1 })));
    const two = await send(envelope(doc({ "x-b": 2 })));
    state.caller = EXTRON_REP;
    expect(await brand.declineSuggestion(String(one.body.revision_id), "Not accurate")).toEqual({ ok: true });
    expect(revision(String(one.body.revision_id))).toMatchObject({ status: "rejected", review_note: "Not accurate" });

    await publish(
      new Request("https://opendeviceio.org/api/v1/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc())
      })
    );
    expect(revision(String(two.body.revision_id)).status).toBe("suggested");
  });

  it("publishing with ?accepts= closes the suggestion it took up", async () => {
    await verifiedRecord();
    state.caller = ALICE;
    const r = await send(envelope(doc({ "x-c": 3 })));
    state.caller = EXTRON_REP;
    const res = await publish(
      new Request(`https://opendeviceio.org/api/v1/devices?accepts=${r.body.revision_id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc({ "x-c": 4 }))
      })
    );
    expect(res.status).toBe(200);
    expect(revision(String(r.body.revision_id))).toMatchObject({ status: "accepted", reviewer: "Extron" });
  });
});

// Registry paging and ID cleanup brief, item 4: the id prefix is the brand slug.
describe("id prefix = brand slug", () => {
  const withPrefix = (prefix: string, manufacturer = "Extron") => {
    const d = doc();
    d.id = `${prefix}/${EXAMPLE.id.split("/")[1]}`;
    (d.device as Record<string, unknown>).manufacturer = manufacturer;
    return d;
  };

  it("a submission under a retired prefix is rejected with the right id, and nothing is stored", async () => {
    state.caller = ALICE;
    const d = withPrefix("qsys", "QSC");
    const r = await send(envelope(d));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(
      `id prefix 'qsys' doesn't match brand slug 'qsc'. Use the id "qsc/${EXAMPLE.id.split("/")[1]}".`
    );
    expect(state.db.t("record_revisions")).toHaveLength(0);
    expect(state.db.t("registry")).toHaveLength(0);
  });

  it("an alias of the brand name still needs the brand slug", async () => {
    state.caller = ALICE;
    expect((await send(envelope(withPrefix("q-sys", "Q-SYS")))).status).toBe(400);
    const ok = await send(envelope(withPrefix("qsc", "Q-SYS")));
    expect(ok.status).toBeLessThan(300);
  });

  it("the brand's stored slug is the authority", async () => {
    state.caller = ALICE;
    state.db.t("organizations").push({
      id: "0rg00000-0000-4000-8000-0000000000e1",
      kind: "manufacturer",
      name: "Extron",
      slug: "extron-a1b2c3",
      manufacturer: "Extron",
      status: "verified"
    });
    const r = await send(envelope(withPrefix("extron")));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("brand slug 'extron-a1b2c3'");
  });

  it("a manufacturer publish under another prefix is rejected before anything is written", async () => {
    seedDraft();
    state.caller = EXTRON_REP;
    const before = state.db.t("record_revisions").length;
    const res = await publish(
      new Request("https://opendeviceio.org/api/v1/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withPrefix("extron-electronics"))
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "id prefix 'extron-electronics' doesn't match brand slug 'extron'"
    );
    expect(state.db.t("record_revisions")).toHaveLength(before);
  });
});
