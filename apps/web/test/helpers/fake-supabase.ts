// A small in-memory stand-in for the parts of supabase-js the registry write
// paths use (from().select/insert/update/upsert + eq/neq/in/not/is/gte, single,
// maybeSingle, limit, order, count/head, auth.admin.getUserById). It is not a
// database: RLS, triggers and constraints are tested against real Postgres
// (see the 0008 checks in the PR). Hooks let a test emulate a trigger error.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

export interface FakeOptions {
  /** Called before each insert; return an error message to reject it (like a trigger). */
  beforeInsert?: (table: string, row: Row, db: FakeDb) => string | null;
  users?: Record<string, string>; // id -> email
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  constructor(public opts: FakeOptions = {}) {}
  t(name: string): Row[] {
    this.tables[name] ??= [];
    return this.tables[name];
  }
  client() {
    return {
      from: (table: string) => new Query(this, table),
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: { user: this.opts.users?.[id] ? { id, email: this.opts.users[id] } : null },
            error: null
          })
        }
      }
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }
}

const DEFAULTS: Record<string, () => Row> = {
  record_revisions: () => ({
    id: uuid(),
    created_at: new Date().toISOString(),
    status: "pending",
    source_org_id: null,
    base_revision_id: null,
    is_new_record: false,
    change_note: null,
    terms_version: null,
    reviewer: null,
    reviewed_at: null,
    review_note: null
  }),
  registry: () => ({
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_type: "machine-draft",
    source_org_id: null,
    current_revision_id: null
  })
};

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row[] = [];
  private conflict: string[] = [];
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private lim: number | null = null;
  private wantCount = false;
  private head = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.op = "select";
    else this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  update(vals: Row) {
    this.op = "update";
    this.payload = [vals];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filters.push((r) => r[c] !== null && r[c] !== undefined);
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => typeof r[c] === "string" && (r[c] as string) >= v);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private match(r: Row) {
    return this.filters.every((f) => f(r));
  }

  private exec(): { data: unknown; error: unknown; count?: number | null } {
    const rows = this.db.t(this.table);
    let out: Row[] = [];
    if (this.op === "select") {
      out = rows.filter((r) => this.match(r));
    } else if (this.op === "insert") {
      for (const p of this.payload) {
        const row = { ...(DEFAULTS[this.table]?.() ?? {}), ...p };
        const err = this.db.opts.beforeInsert?.(this.table, row, this.db);
        if (err) return { data: null, error: { message: err } };
        rows.push(row);
        out.push(row);
      }
    } else if (this.op === "upsert") {
      for (const p of this.payload) {
        const existing = rows.find((r) => this.conflict.every((k) => r[k] === p[k]));
        if (existing) {
          Object.assign(existing, p, this.table === "registry" ? { updated_at: new Date().toISOString() } : {});
          out.push(existing);
        } else {
          const row = { ...(DEFAULTS[this.table]?.() ?? {}), ...p };
          rows.push(row);
          out.push(row);
        }
      }
    } else if (this.op === "update") {
      for (const r of rows) if (this.match(r)) {
        Object.assign(r, this.payload[0]);
        out.push(r);
      }
    } else if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !this.match(r));
    }
    if (this.lim !== null) out = out.slice(0, this.lim);
    const count = this.wantCount ? out.length : null;
    if (this.head) return { data: null, error: null, count };
    if (this.op !== "select" && !this.returning && this.mode === "many") {
      return { data: null, error: null, count };
    }
    if (this.mode === "single") {
      return out.length === 1
        ? { data: { ...out[0] }, error: null }
        : { data: null, error: { message: `expected 1 row, got ${out.length}` } };
    }
    if (this.mode === "maybe") return { data: out[0] ? { ...out[0] } : null, error: null };
    return { data: out.map((r) => ({ ...r })), error: null, count };
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    ok?: ((v: { data: unknown; error: unknown; count?: number | null }) => T1 | PromiseLike<T1>) | null,
    bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(ok, bad);
  }
}
