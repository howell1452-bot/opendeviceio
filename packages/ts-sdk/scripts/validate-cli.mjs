// Tiny CLI: validate one or more .odio.json files against the bundled schema.
//   node scripts/validate-cli.mjs file1.odio.json [file2 ...]
// If no files are given, validates the repository example corpus.

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { glob } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

// Import the built ESM entry; fall back to a helpful message if not built.
let validateDocument, formatErrors;
try {
  ({ validateDocument, formatErrors } = await import(
    pathToFileURL(path.join(pkgRoot, "dist", "esm", "index.js")).href
  ));
} catch {
  console.error("Build first: `npm run build` (dist/esm/index.js not found).");
  process.exit(2);
}

let files = process.argv.slice(2);
if (files.length === 0) {
  const examplesDir = path.resolve(pkgRoot, "..", "..", "examples");
  files = [];
  for await (const f of glob("**/*.odio.json", { cwd: examplesDir })) {
    // Skip the intentionally-invalid fixtures (they are expected to fail).
    if (f.split(/[\\/]/).includes("invalid")) continue;
    files.push(path.join(examplesDir, f));
  }
}

let failures = 0;
for (const file of files) {
  let obj;
  try {
    obj = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    console.error(`PARSE-ERROR ${file}: ${e.message}`);
    failures++;
    continue;
  }
  const res = validateDocument(obj);
  if (res.valid) {
    console.log(`OK    ${file}  (${res.kind})`);
  } else {
    failures++;
    console.log(`FAIL  ${file}  (${res.kind})`);
    console.log(formatErrors(res.errors));
  }
}

process.exit(failures > 0 ? 1 : 0);
