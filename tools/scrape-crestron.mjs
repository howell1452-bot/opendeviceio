#!/usr/bin/env node
// Bulk-download Crestron spec sheets for the OpenDeviceIO catalog ingest.
//
// Crestron's support search renders spec sheets as direct PDF links of the form
//   https://www.crestron.com/getmedia/<guid>/ss_<MODEL>   (Content-Type application/pdf)
// paginated by ?type=Spec_Sheets&c=0&m=<pageSize>&p=<page>. This script paginates
// the search to collect every link, then downloads each PDF (resumable + rate-limited)
// and writes a manifest.json mapping model -> guid -> url -> file.
//
// These are public spec sheets; we bulk-download for an interoperability database and
// keep provenance. Be a good citizen: modest concurrency + a delay (defaults below).
// Review Crestron's Terms of Use before a full run.
//
// Usage:
//   node tools/scrape-crestron.mjs --list-only            # paginate + write manifest, no PDFs
//   node tools/scrape-crestron.mjs                        # download all into corpus/crestron/
//   node tools/scrape-crestron.mjs --limit 10             # just the first 10 (smoke test)
//   node tools/scrape-crestron.mjs --out corpus/crestron --concurrency 4 --delay 300

import { mkdirSync, existsSync, statSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const BASE = "https://www.crestron.com";
const PAGE_SIZE = 100;

// --- args ----------------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const listOnly = argv.includes("--list-only");
const outDir = resolve(getArg("out", join(repoRoot, "corpus", "crestron")));
const concurrency = Math.max(1, parseInt(getArg("concurrency", "4"), 10));
const delayMs = Math.max(0, parseInt(getArg("delay", "300"), 10));
const limit = getArg("limit", null) ? parseInt(getArg("limit", "0"), 10) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (model) =>
  model.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";

async function fetchText(url, tries = 3) {
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return await res.text();
      if (res.status === 404) return "";
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (t === tries) throw e;
      await sleep(500 * t);
    }
  }
  return "";
}

// --- 1. paginate the search, collecting unique spec-sheet links ----------------
async function collectLinks() {
  const seen = new Map(); // guid -> { guid, model, url }
  const re = /href="(\/getmedia\/([0-9a-f-]{36})\/(ss_[^"]+))"/gi;
  for (let p = 1; ; p++) {
    const url = `${BASE}/Support/Search-Results?q=&type=Spec_Sheets&c=0&p=${p}&m=${PAGE_SIZE}&o=0`;
    const html = await fetchText(url);
    let added = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, path, guid, tail] = m;
      if (seen.has(guid)) continue;
      const model = decodeURIComponent(tail.replace(/^ss_/, "")).trim();
      seen.set(guid, { guid, model, url: BASE + path });
      added++;
    }
    process.stdout.write(`  page ${p}: +${added} (total ${seen.size})\n`);
    if (added === 0) break; // no new links -> past the last page
    await sleep(delayMs);
  }
  return [...seen.values()];
}

// --- 2. download a PDF (resumable: skip existing non-empty files) ---------------
async function download(item) {
  const file = join(outDir, `${safeName(item.model)}.pdf`);
  if (existsSync(file) && statSync(file).size > 0) return { ...item, file, skipped: true };
  const res = await fetch(item.url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${item.url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return { ...item, file, bytes: statSync(file).size };
}

async function run() {
  console.log(`Collecting Crestron spec-sheet links (m=${PAGE_SIZE})…`);
  let items = await collectLinks();
  items.sort((a, b) => a.model.localeCompare(b.model));
  if (limit) items = items.slice(0, limit);
  console.log(`Found ${items.length} spec sheets${limit ? ` (limited to ${limit})` : ""}.`);

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
