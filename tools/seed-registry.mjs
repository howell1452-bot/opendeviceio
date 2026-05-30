#!/usr/bin/env node
// OpenDeviceIO registry seed/ingest tool.
//
// Reads every .odio.json under examples/ (excluding examples/invalid/), derives
// the registry row metadata, and either:
//   * prints idempotent upsert SQL to stdout (default), or
//   * applies it directly via the Supabase REST API when --apply is passed and
//     SUPABASE_URL + a SUPABASE_SECRET_KEY (sb_secret_..., the modern replacement
//     for the deprecated service_role key) are set — the reproducible path used as
//     the corpus grows / in CI. (The print form can also be run through an admin
//     SQL connection, e.g. the Supabase MCP, with no key at all.)
//
// Usage:
//   node tools/seed-registry.mjs                              # print SQL for examples/
//   node tools/seed-registry.mjs <dir>                        # print SQL for a staging dir
//   node tools/seed-registry.mjs <dir> --status=reviewed,manufacturer-verified
//   node tools/seed-registry.mjs <dir> --status=reviewed --apply   # upsert reviewed only (needs secret key)
//
// Default dir is examples/. --status filters by validation_status (comma-separated)
// so the catalog-ingest flow can push only human-reviewed drafts to the registry.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const examplesDir = join(repoRoot, "examples");
const EXT = ".odio.json";

function walkOdioFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "invalid") continue; // intentionally non-conformant fixtures
      out.push(...walkOdioFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(EXT)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

// Deep-collect every string value stored under the given keys, anywhere in the doc.
function collectByKey(node, keys, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const v of node) collectByKey(v, keys, acc);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (keys.includes(k) && typeof v === "string") acc.add(v);
      else collectByKey(v, keys, acc);
    }
  }
  return acc;
}

function rowFor(doc) {
  const kind = doc.kind || "device";
  const identity =
    kind === "bundle" ? doc.bundle : kind === "cable" ? doc.cable : doc.device;
  const id = doc.id;
  const validation = doc.provenance?.validation?.status ?? null;
  const portCount = kind === "device" && Array.isArray(doc.ports) ? doc.ports.length : null;
  const connectors = [...collectByKey(doc, ["connector"])].sort();
  const transports = [...collectByKey(doc, ["transport"])].sort();
  return {
    id,
    kind,
    manufacturer: identity?.manufacturer ?? null,
    model: identity?.model ?? null,
    category: identity?.category ?? null,
    product_line: identity?.productLine ?? null,
    sku: identity?.sku ?? null,
    validation_status: validation,
    odio_version: doc.odioVersion ?? null,
    port_count: portCount,
    connectors,
    transports,
    document: doc,
  };
}

// --- CLI args ------------------------------------------------------------------
// Positional: input directory to ingest (default: examples/). Flags: --apply,
// --status=reviewed,manufacturer-verified (only upsert rows whose
// validation_status is in the set — use this to push only reviewed catalog files).
const argv = process.argv.slice(2);
const positionals = argv.filter((a) => !a.startsWith("--"));
const inputDir = positionals[0] ? resolve(positionals[0]) : examplesDir;
const statusArg =
  argv.find((a) => a.startsWith("--status="))?.slice("--status=".length) ??
  (argv.includes("--status") ? argv[argv.indexOf("--status") + 1] : null);
const statusFilter = statusArg
  ? new Set(statusArg.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

const files = walkOdioFiles(inputDir).sort();
let rows = files.map((f) => rowFor(JSON.parse(readFileSync(f, "utf8"))));
if (statusFilter) rows = rows.filter((r) => statusFilter.has(r.validation_status));

// Collapse duplicate ids before upsert: two source documents can extract to the
// same device id (e.g. amp-x300.pdf + amp-x300_1.pdf), but `id` is the registry's
// primary key and a single upsert command cannot touch the same id twice. Last
// wins (files are sorted, so this is deterministic); report what was collapsed.
{
  const byId = new Map();
  const collapsed = [];
  for (const r of rows) {
    if (byId.has(r.id)) collapsed.push(r.id);
    byId.set(r.id, r);
  }
  if (collapsed.length > 0) {
    console.error(`Collapsed ${collapsed.length} duplicate id(s) (last wins): ${collapsed.join(", ")}`);
  }
  rows = [...byId.values()];
}

// --- SQL emission --------------------------------------------------------------
const dq = (s) => (s == null ? "null" : `$q$${s}$q$`);
const arr = (a) => `array[${a.map((x) => `$q$${x}$q$`).join(",")}]::text[]`;
const jsonb = (o) => `$j$${JSON.stringify(o)}$j$::jsonb`;
const intOrNull = (n) => (n == null ? "null" : String(n));

const cols =
  "id, kind, manufacturer, model, category, product_line, sku, validation_status, odio_version, port_count, connectors, transports, document";

function valuesFor(r) {
  return `(${dq(r.id)}, ${dq(r.kind)}, ${dq(r.manufacturer)}, ${dq(r.model)}, ${dq(r.category)}, ${dq(r.product_line)}, ${dq(r.sku)}, ${dq(r.validation_status)}, ${dq(r.odio_version)}, ${intOrNull(r.port_count)}, ${arr(r.connectors)}, ${arr(r.transports)}, ${jsonb(r.document)})`;
}

const updateCols = cols
  .split(", ")
  .filter((c) => c !== "id")
  .map((c) => `${c} = excluded.${c}`)
  .join(", ");

const sql =
  rows.length === 0
    ? "-- seed-registry: no matching .odio.json rows to upsert."
    : `insert into public.registry (${cols}) values\n` +
      rows.map(valuesFor).join(",\n") +
      `\non conflict (id) do update set ${updateCols};`;

function loadDotEnv() {
  // Minimal, non-overriding .env loader (repo root) so the service key can live
  // in the gitignored .env rather than the shell.
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
  if (rows.length === 0) {
    console.error("No matching .odio.json rows to upsert (check the directory / --status filter).");
    return;
  }
  loadDotEnv();
  const url = process.env.SUPABASE_URL || "https://vkbgtbvawhuajkortcka.supabase.co";
  // sb_secret_... (modern) or, for older projects, a service_role key.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("--apply needs SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...) in the environment.");
    process.exit(2);
  }
  const payload = rows.map((r) => ({
    id: r.id, kind: r.kind, manufacturer: r.manufacturer, model: r.model,
    category: r.category, product_line: r.product_line, sku: r.sku,
    validation_status: r.validation_status, odio_version: r.odio_version,
    port_count: r.port_count, connectors: r.connectors, transports: r.transports,
    document: r.document,
  }));
  // Chunk the upsert so a large catalog stays well under any request-body limit.
  const CHUNK = Number(process.env.SEED_CHUNK || 250);
  let done = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const batch = payload.slice(i, i + CHUNK);
    const res = await fetch(`${url}/rest/v1/registry?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error(`Upsert failed at rows ${i}-${i + batch.length} (after ${done} ok): ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    done += batch.length;
    console.error(`  upserted ${done}/${payload.length}…`);
  }
  console.error(`Upserted ${done} registry rows.`);
}

if (process.argv.includes("--apply")) {
  await apply();
} else {
  process.stdout.write(sql + "\n");
}
