#!/usr/bin/env node
// OpenDeviceIO conformance runner.
//
// Validates the example corpus against the canonical JSON Schema
// (schema/v0.1/device.schema.json):
//   - every examples/*.odio.json MUST validate (conformant)
//   - every examples/invalid/*.odio.json MUST fail validation (non-conformant)
//
// Exit code 0 if all expectations hold, 1 otherwise. Used by the "schema"
// CI job and runnable locally via `npm run validate:examples`.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const schemaPath = join(repoRoot, "schema", "v0.1", "device.schema.json");
const validDir = join(repoRoot, "examples");
const invalidDir = join(repoRoot, "examples", "invalid");

const EXT = ".odio.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listOdio(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(EXT))
    .map((e) => join(dir, e.name))
    .sort();
}

function formatErrors(errors) {
  if (!errors || errors.length === 0) return "(no error detail)";
  return errors
    .map((e) => `      ${e.instancePath || "/"} ${e.message}`)
    .join("\n");
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schema = readJson(schemaPath);
const validate = ajv.compile(schema);

let failures = 0;
let checked = 0;

console.log(`OpenDeviceIO conformance runner`);
console.log(`schema: ${schemaPath}\n`);

console.log(`Valid corpus (must PASS):`);
for (const file of listOdio(validDir)) {
  checked++;
  const ok = validate(readJson(file));
  if (ok) {
    console.log(`  PASS  ${file}`);
  } else {
    failures++;
    console.log(`  FAIL  ${file}  (expected valid, got errors)`);
    console.log(formatErrors(validate.errors));
  }
}

console.log(`\nInvalid corpus (must FAIL):`);
for (const file of listOdio(invalidDir)) {
  checked++;
  const ok = validate(readJson(file));
  if (!ok) {
    console.log(`  PASS  ${file}  (correctly rejected)`);
  } else {
    failures++;
    console.log(`  FAIL  ${file}  (expected invalid, but it validated)`);
  }
}

console.log(`\nChecked ${checked} file(s); ${failures} unexpected result(s).`);

if (checked === 0) {
  console.error("No example files found — nothing was validated.");
  process.exit(1);
}

process.exit(failures === 0 ? 0 : 1);
