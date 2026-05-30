#!/usr/bin/env node
// OpenDeviceIO conformance runner.
//
// Validates the example corpus against the canonical JSON Schemas in schema/v0.1/:
//   - every examples/*.odio.json         MUST validate against device.schema.json
//   - every examples/invalid/*.odio.json MUST fail device validation
//   - every examples/bundles/*.odio.json MUST validate against bundle.schema.json
//
// The bundle and cable schemas $ref the device schema, so all three are loaded
// into one Ajv instance. Exit code 0 if all expectations hold, 1 otherwise.
// Used by the "schema" CI job and runnable via `npm run validate:examples`.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const schemaDir = join(repoRoot, "schema", "v0.1");
const deviceSchemaPath = join(schemaDir, "device.schema.json");
const cableSchemaPath = join(schemaDir, "cable.schema.json");
const bundleSchemaPath = join(schemaDir, "bundle.schema.json");

const validDir = join(repoRoot, "examples");
const invalidDir = join(repoRoot, "examples", "invalid");
const bundlesDir = join(repoRoot, "examples", "bundles");

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

// Load all three schemas so cross-schema $refs (bundle/cable -> device) resolve.
const deviceSchema = readJson(deviceSchemaPath);
const cableSchema = readJson(cableSchemaPath);
const bundleSchema = readJson(bundleSchemaPath);
ajv.addSchema(deviceSchema);
ajv.addSchema(cableSchema);
ajv.addSchema(bundleSchema);

const validateDevice = ajv.getSchema(deviceSchema.$id);
const validateBundle = ajv.getSchema(bundleSchema.$id);

let failures = 0;
let checked = 0;

function expectValid(file, validate, label) {
  checked++;
  const ok = validate(readJson(file));
  if (ok) {
    console.log(`  PASS  ${file}`);
  } else {
    failures++;
    console.log(`  FAIL  ${file}  (expected valid ${label}, got errors)`);
    console.log(formatErrors(validate.errors));
  }
}

console.log(`OpenDeviceIO conformance runner`);
console.log(`schemas: ${schemaDir}\n`);

console.log(`Valid devices (must PASS device schema):`);
for (const file of listOdio(validDir)) expectValid(file, validateDevice, "device");

console.log(`\nValid bundles (must PASS bundle schema):`);
const bundleFiles = listOdio(bundlesDir);
if (bundleFiles.length === 0) console.log(`  (none)`);
for (const file of bundleFiles) expectValid(file, validateBundle, "bundle");

console.log(`\nInvalid devices (must FAIL device schema):`);
for (const file of listOdio(invalidDir)) {
  checked++;
  const ok = validateDevice(readJson(file));
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
