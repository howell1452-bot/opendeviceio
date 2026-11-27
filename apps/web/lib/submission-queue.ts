import type { SupabaseClient } from "@supabase/supabase-js";
import { diffDocuments, setChange, summarize, type DiffLine, type DocSummary } from "./doc-diff";
import { orgNames } from "./orgs";

// Open revisions (pending / suggested) with what a reviewer needs: a diff
// against the live record and a source label. Used by /admin (service client,
// with submitter details) and /account (the brand's own client; no submitter
// identity). Server-only.

export interface QueueItem {
  id: string;
  recordId: string;
  manufacturer: string | null;
  status: "pending" | "suggested";
  sourceType: string;
  /** "Community submission", or the vendor org's name. */
  sourceLabel: string;
  createdAt: string;
  changeNote: string | null;
  isNew: boolean;
  /** validation_status of the live record, or null when the id is new. */
  currentStatus: string | null;
  before: DocSummary | null;
  after: DocSummary;
  connectors: { added: string[]; removed: string[] };
  transports: { added: string[]; removed: string[] };
  diff: { lines: DiffLine[]; total: number };
  /** Admin view only. */
  submitter?: { email: string | null; acceptedCount: number; trusted: boolean } | null;
}

interface RawRevision {
  id: string;
  record_id: string;
  manufacturer: string | null;
  status: "pending" | "suggested";
  source_type: string;
  source_org_id: string | null;
  created_at: string;
  change_note: string | null;
  is_new_record: boolean;
  document: unknown;
  submitted_by?: string | null;
}

const BASE_COLUMNS =
  "id,record_id,manufacturer,status,source_type,source_org_id,created_at,change_note,is_new_record,document";

async function build(
  client: SupabaseClient,
  service: SupabaseClient | null,
  revs: RawRevision[]
): Promise<QueueItem[]> {
  if (revs.length === 0) return [];
  const ids = [...new Set(revs.map((r) => r.record_id))];
  const { data: live } = await client
    .from("registry")
    .select("id,validation_status,document")
    .in("id", ids);
  const liveById = new Map(
    ((live ?? []) as Array<{ id: string; validation_status: string | null; document: unknown }>).map(
      (r) => [r.id, r]
    )
  );
  const names = service ? await orgNames(service, revs.map((r) => r.source_org_id)) : new Map();

  return revs.map((r) => {
    const cur = liveById.get(r.record_id);
    const before = cur ? summarize(cur.document) : null;
    const after = summarize(r.document);
    return {
      id: r.id,
      recordId: r.record_id,
      manufacturer: r.manufacturer,
      status: r.status,
      sourceType: r.source_type,
      sourceLabel:
        r.source_type === "design-vendor"
          ? `Design vendor · ${names.get(r.source_org_id ?? "") ?? "organization"}`
          : "Community submission",
      createdAt: r.created_at,
      changeNote: r.change_note,
      isNew: !cur,
      currentStatus: cur ? cur.validation_status ?? "draft" : null,
      before,
      after,
      connectors: setChange(before?.connectors ?? [], after.connectors),
      transports: setChange(before?.transports ?? [], after.transports),
      diff: diffDocuments(cur?.document ?? null, r.document, 150)
    };
  });
}

/** Admin queue: every open community / vendor revision, oldest first, with submitter details. */
export async function loadAdminQueue(service: SupabaseClient, limit = 50): Promise<QueueItem[]> {
  const { data, error } = await service
    .from("record_revisions")
    .select(`${BASE_COLUMNS},submitted_by`)
    .in("status", ["pending", "suggested"])
    .in("source_type", ["community", "design-vendor"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const revs = (data ?? []) as RawRevision[];
  const items = await build(service, service, revs);

  const userIds = [...new Set(revs.map((r) => r.submitted_by).filter((x): x is string => Boolean(x)))];
  const status = new Map<string, { accepted_count: number; trusted: boolean }>();
  if (userIds.length > 0) {
    const { data: cs } = await service
      .from("contributor_status")
      .select("user_id,accepted_count,trusted")
      .in("user_id", userIds);
    for (const c of (cs ?? []) as Array<{ user_id: string; accepted_count: number; trusted: boolean }>) {
      status.set(c.user_id, c);
    }
  }
  const emails = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data: u } = await service.auth.admin.getUserById(uid);
        emails.set(uid, u?.user?.email ?? null);
      } catch {
        emails.set(uid, null);
      }
    })
  );

  return items.map((item, i) => {
    const uid = revs[i].submitted_by;
    return {
      ...item,
      submitter: uid
        ? {
            email: emails.get(uid) ?? null,
            acceptedCount: status.get(uid)?.accepted_count ?? 0,
            trusted: status.get(uid)?.trusted ?? false
          }
        : null
    };
  });
}

/**
 * A brand's queue: open revisions for its records, read with the member's own
 * client (RLS allows brand members to read them; submitter identity is not
 * readable). Org names come from the service client when available.
 */
export async function loadBrandQueue(
  client: SupabaseClient,
  service: SupabaseClient | null,
  brands: string[],
  limit = 50
): Promise<QueueItem[]> {
  if (brands.length === 0) return [];
  const { data, error } = await client
    .from("record_revisions")
    .select(BASE_COLUMNS)
    .in("manufacturer", brands)
    .in("status", ["pending", "suggested"])
    .in("source_type", ["community", "design-vendor"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return build(client, service, (data ?? []) as RawRevision[]);
}
