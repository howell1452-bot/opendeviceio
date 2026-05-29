// After `tsc -p tsconfig.cjs.json` emits CommonJS .js files into dist/cjs,
// rename them to .cjs (so Node treats them as CommonJS even though the
// package is "type":"module") and rewrite intra-package require() specifiers
// to point at the renamed files. Also drops a package.json marker.

import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cjsDir = path.resolve(here, "..", "dist", "cjs");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

const jsFiles = [];
for await (const f of walk(cjsDir)) {
  if (f.endsWith(".js")) jsFiles.push(f);
}

// Rewrite relative require("./x") and require("./x.js") -> require("./x.cjs")
const requireRe = /require\((["'])(\.\.?\/[^"']*?)\1\)/g;
for (const file of jsFiles) {
  let code = await readFile(file, "utf8");
  code = code.replace(requireRe, (_m, q, spec) => {
    let target = spec.replace(/\.js$/, "");
    return `require(${q}${target}.cjs${q})`;
  });
  await writeFile(file, code, "utf8");
}

for (const file of jsFiles) {
  await rename(file, file.replace(/\.js$/, ".cjs"));
}

// Mark this directory as CommonJS for Node's resolver.
await writeFile(
  path.join(cjsDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8"
);

console.log(`finalize-cjs: rewrote and renamed ${jsFiles.length} file(s) to .cjs`);
