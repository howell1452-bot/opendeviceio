// listRegistry and a page past the end (registry paging brief, item 1): the
// API answers an offset past the last row with HTTP 416 (PGRST103). That is
// an empty page with a known total, not "database unavailable", so /registry
// can 404 it.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null; count: number | null };

const calls: Array<{ head: boolean; filters: string[]; range?: [number, number] }> = [];
const state: { total: number; failAll: boolean } = { total: 130, failAll: false };

/** A minimal stand-in for the Supabase query builder, answering like PostgREST. */
function builder(head: boolean) {
  const call: { head: boolean; filters: string[]; range?: [number, number] } = { head, filters: [] };
  calls.push(call);
  const b = {
    in: (c: string) => (call.filters.push(`in:${c}`), b),
    eq: (c: string, v: unknown) => (call.filters.push(`eq:${c}=${String(v)}`), b),
    gte: (c: string) => (call.filters.push(`gte:${c}`), b),
    contains: (c: string) => (call.filters.push(`contains:${c}`), b),
    or: (expr: string) => (call.filters.push(`or:${expr}`), b),
    order: () => b,
    range: (from: number, to: number) => ((call.range = [from, to]), b),
    then: (resolve: (r: Result) => unknown) => {
      if (state.failAll) return resolve({ data: null, error: { message: "connection refused" }, count: null });
      if (head) return resolve({ data: null, error: null, count: state.total });
      const [from, to] = call.range ?? [0, state.total - 1];
      if (from >= state.total && from > 0) {
        return resolve({ data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null });
      }
      const rows = Array.from({ length: Math.max(0, Math.min(to, state.total - 1) - from + 1) }, (_, i) => ({
        id: `paging-labs/p${from + i}`,
        source_org: null
      }));
      return resolve({ data: rows, error: null, count: state.total });
    }
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({ select: (_cols: string, opts?: { head?: boolean }) => builder(Boolean(opts?.head)) })
  })
}));

const { listRegistry } = await import("../lib/registry");

beforeEach(() => {
  calls.length = 0;
  state.total = 130;
  state.failAll = false;
});

describe("listRegistry paging", () => {
  it("returns the window and the exact total", async () => {
    const r = await listRegistry({ manufacturer: "Paging Labs", limit: 100, offset: 100 });
    expect(r).toMatchObject({ total: 130, unavailable: false });
    expect(r.rows).toHaveLength(30);
  });

  it("an offset past the end is an empty page with the real total, counted with the same filters", async () => {
    const r = await listRegistry({ manufacturer: "Paging Labs", search: "p1", limit: 100, offset: 200 });
    expect(r).toEqual({ rows: [], total: 130, unavailable: false });
    const count = calls.find((c) => c.head);
    expect(count?.filters).toEqual(calls[0].filters);
    expect(count?.filters).toContain("eq:manufacturer=Paging Labs");
  });

  it("a database that is down is still 'unavailable'", async () => {
    state.failAll = true;
    expect(await listRegistry({ limit: 100, offset: 200 })).toEqual({ rows: [], total: null, unavailable: true });
  });
});
