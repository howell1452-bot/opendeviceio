#!/usr/bin/env node
// Copy the repo's canonical JSON Schema files into the web app's public/ tree so
// they are served verbatim at the versioned $id URLs (/schema/v0.1/*.schema.json).
//
// The copied files MUST be byte-identical to the repo originals — they are the
// canonical contract. This runs as a prebuild/predev step.

import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "..", "..");
const srcDir = join(repoRoot, "schema", "v0.1");
const destDir = join(appRoot, "public", "schema", "v0.1");

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith(".schema.json"));
if (files.length === 0) {
  console.error(`sync-schema: no *.schema.json files found in ${srcDir}`);
  process.exit(1);
}

let copied = 0;
for (const file of files) {
  const data = readFileSync(join(srcDir, file)); // Buffer -> byte-identical copy
  writeFileSync(join(destDir, file), data);
  copied++;
}

console.error(`sync-schema: copied ${copied} schema file(s) to ${destDir}`);
