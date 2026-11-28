#!/usr/bin/env node
// Fail when any registry record's id prefix isn't its manufacturer's brand slug
// (registry paging and ID cleanup brief, item 4c).
//
//   node scripts/check-id-prefixes.mjs --db
//       Read a Postgres database with psql (standard PG* variables, or
//       DATABASE_URL) and compare each id with organizations.slug, the slug the
//       database's id_prefix_mismatch trigger enforces. No npm packages needed.
//
//   node scripts/check-id-prefixes.mjs --api https://opendeviceio.org
//       Page the public, read-only GET /api/v1/devices and compare each id with
//       the brand slug of its canonical manufacturer (the SDK's
//       expectedIdPrefix; build the SDK first: npm run build:sdk).
//
// Prints every offender and exits 1 if there is one; prints the count and
// exits 0 otherwise.

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const mode = args[0];

function report(rows, source) {
  const bad = rows.filter((r) => r.expected && r.prefix !== r.expected);
  for (const r of bad) {
    console.log(`MISMATCH ${r.id}  manufacturer=${JSON.stringify(r.manufacturer)}  prefix=${r.prefix}  brand slug=${r.expected}`);
  }
  console.log(`${bad.length} mismatches in ${rows.length} records (${source})`);
  process.exit(bad.length === 0 ? 0 : 1);
}

function prefixOf(id) {
  const slash = id.indexOf("/");
  return slash < 0 ? "" : id.slice(0, slash);
}

async function fromDatabase() {
  const sql = `
    select coalesce(json_agg(json_build_object('id', r.id, 'manufacturer', r.manufacturer, 'slug', o.slug)), '[]')
      from public.registry r
      left join public.organizations o on o.kind = 'manufacturer' and o.manufacturer = r.manufacturer
     where r.manufacturer is not null`;
  const psqlArgs = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql];
  if (process.env.DATABASE_URL) psqlArgs.unshift(process.env.DATABASE_URL);
  const out = execFileSync("psql", psqlArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const rows = JSON.parse(out.trim() || "[]");
  report(
    rows.map((r) => ({
      id: r.id,
      manufacturer: r.manufacturer,
      prefix: prefixOf(r.id),
      // A record whose brand has no profile row is itself a problem: say so.
      expected: r.slug ?? "(no brand profile)"
    })),
    "database"
  );
}

async function fromApi(base) {
  const { expectedIdPrefix } = await import("@opendeviceio/sdk");
  const origin = base.replace(/\/+$/, "");
  const limit = 200;
  const rows = [];
  for (let offset = 0; ; offset += limit) {
    const url = `${origin}/api/v1/devices?limit=${limit}&offset=${offset}`;
    let res;
    for (let attempt = 1; ; attempt++) {
      res = await fetch(url, { headers: { accept: "application/json", "user-agent": "odio-check-id-prefixes" } });
      if (res.ok || attempt >= 4 || res.status < 500) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    if (!res.ok) {
      console.error(`GET ${url} -> ${res.status}`);
      process.exit(2);
    }
    const body = await res.json();
    const page = Array.isArray(body.data) ? body.data : [];
    for (const d of page) {
      rows.push({
        id: d.id,
        manufacturer: d.manufacturer,
        prefix: prefixOf(d.id),
        expected: expectedIdPrefix(d.manufacturer)
      });
    }
    if (page.length < limit || rows.length >= (body.total ?? 0)) break;
  }
  report(rows, origin);
}

if (mode === "--db") {
  await fromDatabase();
} else if (mode === "--api" && args[1]) {
  await fromApi(args[1]);
} else {
  console.error("usage: check-id-prefixes.mjs --db | --api <origin>");
  process.exit(2);
}
