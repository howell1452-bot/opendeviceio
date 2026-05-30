#!/usr/bin/env node
// Bulk-download Shure spec sheets for the OpenDeviceIO catalog ingest.
//
// Shure's site search is Elastic App Search (Swiftype). The public search key and
// engine are embedded in the site's JS, so we query the same API the website does:
//   POST https://initial2022.ent.eu-west-1.aws.found.io/api/as/v1/engines/redesign-meta-prod/search.json
//   Authorization: Bearer search-fbxbkqcj2rc5xbe2y3itp812   (public search key)
// filtered to group=Documents, documenttype="Spec Sheet", language=en-US, discontinued=false.
// Each result's `url` is a pubs.shure.com/file/<n> link that 301s to a PDF on
// content-files.shure.com. This script paginates the search to collect every spec
// sheet, then downloads each PDF (resumable + rate-limited) and writes a manifest.
//
// These are public spec sheets; we bulk-download for an interoperability database and
// keep provenance. Be a good citizen: modest concurrency + a delay (defaults below).
//
// Usage:
//   node tools/scrape-shure.mjs --list-only            # paginate + write manifest, no PDFs
//   node tools/scrape-shure.mjs                        # download all into corpus/shure/
//   node tools/scrape-shure.mjs --limit 10             # just the first 10 (smoke test)
//   node tools/scrape-shure.mjs --out corpus/shure --concurrency 4 --delay 300

import { mkdirSync, existsSync, statSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const SEARCH_URL =
  "https://initial2022.ent.eu-west-1.aws.found.io/api/as/v1/engines/redesign-meta-prod/search.json";
const SEARCH_KEY = "search-fbxbkqcj2rc5xbe2y3itp812"; // public search key (from shure.com JS)
const PAGE_SIZE = 100; // App Search per-page max

// --- args ----------------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const listOnly = argv.includes("--list-only");
const outDir = resolve(getArg("out", join(repoRoot, "corpus", "shure")));
const concurrency = Math.max(1, parseInt(getArg("concurrency", "4"), 10));
const delayMs = Math.max(0, parseInt(getArg("delay", "300"), 10));
const limit = getArg("limit", null) ? parseInt(getArg("limit", "0"), 10) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (s) =>
  s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";

// Model from a "<MODEL> Spec Sheet" title; fall back to product name or doc id.
const modelFromResult = (r) => {
  const raw = (k) => (r[k] && r[k].raw) || "";
  const title = String(raw("title") || "").replace(/\s*spec(ification)?\s*sheet\s*$/i, "").trim();
  if (title) return title;
  const products = raw("products");
  if (Array.isArray(products) && products.length) return String(products[0]);
  return String(raw("id") || "doc");
};

// --- 1. paginate the App Search engine, collecting unique spec-sheet docs -------
async function search(page, tries = 4) {
  const body = {
    query: "",
    page: { size: PAGE_SIZE, current: page },
    sort: [{ id: "asc" }], // stable order across pages
    filters: {
      all: [
        { group: "Documents" },
        { documenttype: "Spec Sheet" },
        { language: "en-US" },
        { discontinued: "false" }
      ]
    }
  };
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Authorization: `Bearer ${SEARCH_KEY}`
        },
        body: JSON.stringify(body)
      });
      if ((res.status === 403 || res.status === 429) && t < tries) {
        await sleep(4000 * t);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (t === tries) throw e;
      await sleep(1000 * t);
    }
  }
  throw new Error("search retries exhausted");
}

async function collectDocs() {
  const seen = new Map(); // id -> { id, model, title, url }
  const first = await search(1);
  const totalPages = first.meta.page.total_pages;
  const total = first.meta.page.total_results;
  console.log(`  ${total} spec sheets across ${totalPages} page(s)`);
  for (let p = 1; p <= totalPages; p++) {
    const data = p === 1 ? first : await search(p);
    let added = 0;
    for (const r of data.results || []) {
      const id = String((r.id && r.id.raw) || "");
      const url = String((r.url && r.url.raw) || "");
      if (!id || !url || seen.has(id)) continue;
      seen.set(id, { id, model: modelFromResult(r), title: (r.title && r.title.raw) || "", url });
      added++;
    }
    process.stdout.write(`  page ${p}/${totalPages}: +${added} (total ${seen.size})\n`);
    if (p < totalPages) await sleep(delayMs);
  }
  return [...seen.values()];
}

// shure.widen.net /s/ share links render an HTML viewer; the real (signed) PDF is a
// previews.*.widencdn.net URL embedded in the page. Resolve it to the direct PDF.
async function resolvePdfUrl(url) {
  if (!/widen\.net\/s\//i.test(url)) return url;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} resolving widen page`);
  const html = await res.text();
  const m = html.match(/https:\/\/previews[a-z0-9.-]*\.widencdn\.net\/preview\/[^"'\\ ]+/i);
  if (!m) throw new Error("no widencdn preview URL in widen page");
  return m[0].replace(/&amp;/g, "&");
}

// --- 2. download a PDF (resumable: skip existing non-empty files) ---------------
async function download(item, tries = 4) {
  const file = join(outDir, `${safeName(item.model)}.pdf`);
  if (existsSync(file) && statSync(file).size > 0) return { ...item, file, skipped: true };
  const dlUrl = await resolvePdfUrl(item.url);
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(dlUrl, { headers: { "User-Agent": UA } }); // follows 301 to content-files
      if ((res.status === 403 || res.status === 429) && t < tries) {
        await sleep(4000 * t);
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${item.url}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
      return { ...item, file, bytes: statSync(file).size };
    } catch (e) {
      if (t === tries) throw e;
      await sleep(2000 * t);
    }
  }
  throw new Error(`exhausted retries for ${item.url}`);
}

async function run() {
  console.log("Collecting Shure spec-sheet documents (en-US, active)…");
  let items = await collectDocs();
  // De-dupe by output filename (multiple docs can map to the same model slug).
  const byName = new Map();
  for (const it of items) {
    const name = safeName(it.model);
    if (!byName.has(name)) byName.set(name, it);
  }
  items = [...byName.values()].sort((a, b) => a.model.localeCompare(b.model));
  if (limit) items = items.slice(0, limit);
  console.log(`Found ${items.length} unique spec sheets${limit ? ` (limited to ${limit})` : ""}.`);

  mkdirSync(outDir, { recursive: true });
  const manifest = items.map((i) => ({ ...i, file: join(outDir, `${safeName(i.model)}.pdf`) }));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${join(outDir, "manifest.json")}`);
  if (listOnly) return;

  let done = 0, failed = 0, skipped = 0;
  const queue = [...items];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const r = await download(item);
        if (r.skipped) skipped++;
        done++;
      } catch (e) {
        failed++;
        console.error(`  FAIL ${item.model}: ${e.message}`);
      }
      if ((done + failed) % 25 === 0)
        process.stdout.write(`  ${done}/${items.length} ok (${skipped} skipped, ${failed} failed)\n`);
      await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`Done: ${done} downloaded/skipped, ${failed} failed → ${outDir}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
