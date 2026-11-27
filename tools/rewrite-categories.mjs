#!/usr/bin/env node
// One-off: rewrite registry categories onto the controlled taxonomy in vocab/.
//
// Rewrites both the `category` column of public.registry and the identity
// category stored inside the document — `document -> <kind> -> 'category'`, i.e.
// device.category for devices and bundle.category for bundles. (Cable documents
// carry no category in schema v0.1; the same kind-keyed path would cover one.)
//
// Usage:
//   node tools/rewrite-categories.mjs             # print the idempotent rewrite SQL (default)
//   node tools/rewrite-categories.mjs --preview   # print a read-only SELECT previewing the effect
//   node tools/rewrite-categories.mjs --apply     # rewrite through the Supabase REST API
//
// The SQL form is for an admin SQL connection (psql, the Supabase SQL editor, or
// the Supabase MCP). It is built from vocab/category-map.json (every category seen
// in production when the taxonomy was drawn up), runs in one transaction, and only
// touches rows whose category is one of the mapped old values — so re-running it
// changes nothing. It deliberately does not set updated_at: the
// registry_set_updated_at BEFORE UPDATE trigger (apps/web/supabase/migrations/0001,
// re-asserted in 0002) bumps it on every row that changes, and the generated
// search_tsv column is recomputed by Postgres. Its trailing SELECT lists any
// category still outside the vocabulary (rows ingested after the snapshot): add
// those to vocab/category-map.json and regenerate.
//
// --apply needs SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_..., or a legacy
// SUPABASE_SERVICE_ROLE_KEY), from the environment or the repo-root .env, like
// tools/seed-registry.mjs. It reads every row (id, kind, category, document),
// normalizes with the SDK's normalizeCategory — the same map plus the light
// canonicalization rules, so it also tidies categories added after the snapshot —
// and PATCHes only rows that change. Build the SDK first:
//   npm run build -w @opendeviceio/sdk

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeCategory,
  CATEGORY_MAP,
  CATEGORY_VOCABULARY,
  CATEGORY_VOCAB_VERSION
} from "@opendeviceio/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// old -> new for every mapped category that actually changes.
const pairs = Object.keys(CATEGORY_MAP)
  .sort()
  .map((old) => [old, normalizeCategory(old)])
  .filter(([old, next]) => old !== next);

const mapCte =
  "with m(old, new) as (\n  values\n" +
  pairs.map(([old, next]) => `    (${q(old)}, ${q(next)})`).join(",\n") +
  "\n)";
const vocabArray =
  "array[\n" +
  CATEGORY_VOCABULARY.map((c) => `    ${q(c.path)}`).join(",\n") +
  "\n  ]::text[]";

function rewriteSql() {
  return `-- rewrite-categories: ${pairs.length} category mappings onto the controlled taxonomy
-- (vocab/categories.json v${CATEGORY_VOCAB_VERSION}, ${CATEGORY_VOCABULARY.length} paths).
-- Idempotent: only rows whose column or document category is a mapped old value
-- are updated. updated_at is bumped by the registry_set_updated_at trigger.
begin;

${mapCte}
update public.registry r
   set category = coalesce((select m.new from m where m.old = r.category), r.category),
       document = coalesce(
         (select jsonb_set(r.document, array[r.kind, 'category'], to_jsonb(m.new))
            from m
           where m.old = r.document -> r.kind ->> 'category'),
         r.document)
 where r.category in (select old from m)
    or r.document -> r.kind ->> 'category' in (select old from m);

-- Anything still outside the controlled vocabulary (expect no rows for the
-- snapshot the map was built from).
select category, count(*) as rows
  from public.registry
 where category is not null
   and category <> all (${vocabArray})
 group by category
 order by rows desc, category;

commit;
`;
}

function previewSql() {
  return `-- rewrite-categories --preview: read-only; shows what the rewrite would do.
${mapCte},
r as (
  select x.category as old_category,
         coalesce((select m.new from m where m.old = x.category), x.category) as new_category,
         x.document -> x.kind ->> 'category' as old_doc_category,
         coalesce((select m.new from m where m.old = x.document -> x.kind ->> 'category'),
                  x.document -> x.kind ->> 'category') as new_doc_category
    from public.registry x
)
select count(*) as rows,
       count(*) filter (where old_category is distinct from new_category
                           or old_doc_category is distinct from new_doc_category) as rows_changed,
       count(distinct old_category) as distinct_before,
       count(distinct new_category) as distinct_after,
       count(distinct new_category) filter (where new_category <> all (${vocabArray})) as uncontrolled_after,
       count(*) filter (where new_category is distinct from new_doc_category) as column_document_mismatch_after
  from r;
`;
}

function loadDotEnv() {
  // Minimal, non-overriding .env loader (repo root), as in seed-registry.mjs.
  try {
    const text = readFileSync(join(repoRoot, ".env"), "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* no .env — rely on the real environment */
  }
}

async function apply() {
  loadDotEnv();
  // No default URL: a bulk rewrite must name its target explicitly.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("--apply needs SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...) in the environment.");
    process.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  // 1. Read every row (paged).
  const PAGE = Number(process.env.REWRITE_PAGE || 500);
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/registry?select=id,kind,category,document&order=id.asc&limit=${PAGE}&offset=${offset}`,
      { headers }
    );
    if (!res.ok) {
      console.error(`Read failed at offset ${offset}: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // 2. Work out the changes.
  const updates = [];
  for (const row of rows) {
    const category = normalizeCategory(row.category ?? null);
    const identity = row.document?.[row.kind];
    const docCategory = identity && typeof identity.category === "string" ? identity.category : null;
    const nextDocCategory = normalizeCategory(docCategory);
    if (category === row.category && nextDocCategory === docCategory) continue;
    const document =
      nextDocCategory !== docCategory
        ? { ...row.document, [row.kind]: { ...identity, category: nextDocCategory } }
        : row.document;
    updates.push({ id: row.id, from: row.category, category, document });
  }
  const nextById = new Map(updates.map((u) => [u.id, u.category]));
  const before = new Set(rows.map((r) => r.category).filter(Boolean));
  const after = new Set(
    rows.map((r) => (nextById.has(r.id) ? nextById.get(r.id) : r.category)).filter(Boolean)
  );
  console.error(
    `Read ${rows.length} rows; ${updates.length} to update; distinct categories ${before.size} -> ${after.size}.`
  );

  // 3. PATCH changed rows (small concurrency; updated_at is set by the trigger).
  const CONCURRENCY = Number(process.env.REWRITE_CONCURRENCY || 8);
  let done = 0;
  let failed = 0;
  const queue = [...updates];
  async function worker() {
    for (let u = queue.shift(); u; u = queue.shift()) {
      const res = await fetch(`${url}/rest/v1/registry?id=eq.${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ category: u.category, document: u.document })
      });
      if (res.ok) {
        done += 1;
        if (done % 250 === 0) console.error(`  updated ${done}/${updates.length}…`);
      } else {
        failed += 1;
        console.error(`  ${u.id}: ${res.status} ${await res.text()}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.error(`Updated ${done} row(s)${failed ? `; ${failed} failed (re-run to retry — it is idempotent)` : ""}.`);
  if (failed) process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes("--apply")) {
  await apply();
} else if (argv.includes("--preview")) {
  process.stdout.write(previewSql());
} else {
  process.stdout.write(rewriteSql());
}
