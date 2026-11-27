// The public /correct form (launch fixes item D): corrections and verify
// requests go through; removal requests are admin-only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";

const state: { db: FakeDb; user: { id: string; email: string } | null; admins: string[] } = {
  db: new FakeDb(),
  user: null,
  admins: []
};

vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({ user: state.user, client: null }),
  isAdminEmail: (email: string | null | undefined) => Boolean(email && state.admins.includes(email))
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.db.client() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest" }) }));

const { submitRecordRequest } = await import("../app/correct/actions");
const { CONTACT_EMAIL } = await import("../lib/project");

const ADMIN = { id: "aaaa0000-0000-4000-8000-0000000000ad", email: "admin@opendeviceio.example" };

function form(type: string, over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const fields: Record<string, string> = {
    request_type: type,
    started_at: String(Date.now() - 60_000),
    name: "Pat Example",
    company: "Acme Devices",
    email: "pat@acme.example",
    record_ids: "acme-devices/x1",
    details: "The rear panel has two Dante ports, not one.",
    ...over
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.db = new FakeDb();
  state.user = null;
  state.admins = [ADMIN.email];
});

describe("submitRecordRequest", () => {
  it("accepts a correction from anyone, no account needed", async () => {
    expect(await submitRecordRequest(form("correction"))).toEqual({ ok: true });
    const rows = state.db.t("record_requests");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ request_type: "correction", record_ids: ["acme-devices/x1"] });
  });

  it("accepts a verify request", async () => {
    expect(await submitRecordRequest(form("verify", { details: "" }))).toEqual({ ok: true });
    expect(state.db.t("record_requests")[0]).toMatchObject({ request_type: "verify" });
  });

  it("turns away a public removal request and points to the legal route", async () => {
    const res = await submitRecordRequest(form("removal"));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("We correct records rather than remove them");
    expect(res.error).toContain(CONTACT_EMAIL);
    expect(state.db.t("record_requests")).toHaveLength(0);
  });

  it("still turns it away for a signed-in non-admin", async () => {
    state.user = { id: "aaaa0000-0000-4000-8000-000000000001", email: "rep@acme.example" };
    expect((await submitRecordRequest(form("removal"))).ok).toBe(false);
    expect(state.db.t("record_requests")).toHaveLength(0);
  });

  it("lets an admin log a takedown", async () => {
    state.user = ADMIN;
    expect(await submitRecordRequest(form("removal"))).toEqual({ ok: true });
    expect(state.db.t("record_requests")[0]).toMatchObject({ request_type: "removal" });
  });
});
