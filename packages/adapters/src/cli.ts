#!/usr/bin/env node
// odio-export — convert a validated .odio.json document into a design-tool
// import format.
//
// Usage:
//   odio-export <input.odio.json> [--target <id>] [-o <out>]
//
//   --target, -t   adapter id (default: easyschematic). One of:
//                  easyschematic | dxf | visio | avcad
//   --out,    -o   output file path. Defaults to the adapter's suggested
//                  filename in the input file's directory.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse, formatErrors, OdioValidationError } from "@opendeviceio/sdk";
import { getAdapter, adapterIds } from "./registry.js";

interface CliArgs {
  input?: string;
  target: string;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { target: "easyschematic" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target" || a === "-t") {
      args.target = argv[++i];
    } else if (a === "--out" || a === "-o") {
      args.out = argv[++i];
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    } else if (args.input === undefined) {
      args.input = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: odio-export <input.odio.json> [--target <id>] [-o <out>]",
      "",
      `  --target, -t   adapter id (default: easyschematic): ${adapterIds.join(", ")}`,
      "  --out,    -o   output file path (default: alongside input)",
      ""
    ].join("\n")
  );
}

function main(): void {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    printUsage();
    process.exit(2);
  }

  if (!args.input) {
    process.stderr.write("Error: missing <input.odio.json>.\n");
    printUsage();
    process.exit(2);
  }

  const adapter = getAdapter(args.target);
  if (!adapter) {
    process.stderr.write(
      `Error: unknown target "${args.target}". Available: ${adapterIds.join(", ")}\n`
    );
    process.exit(2);
  }

  const inputPath = resolve(args.input);
  let raw: string;
  try {
    raw = readFileSync(inputPath, "utf8");
  } catch (err) {
    process.stderr.write(`Error: cannot read "${inputPath}": ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Validate first (SDK throws OdioValidationError on invalid input).
  let device;
  try {
    device = parse(raw);
  } catch (err) {
    if (err instanceof OdioValidationError) {
      process.stderr.write(`Error: invalid OpenDeviceIO document:\n${formatErrors(err.errors)}\n`);
    } else {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
    }
    process.exit(1);
  }

  let result;
  try {
    result = adapter.export(device);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Print warnings to stderr.
  for (const w of result.warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }

  const primary = result.files[0];
  const outPath = args.out
    ? resolve(args.out)
    : join(dirname(inputPath), primary.path);

  try {
    writeFileSync(outPath, primary.content, "utf8");
  } catch (err) {
    process.stderr.write(`Error: cannot write "${outPath}": ${(err as Error).message}\n`);
    process.exit(1);
  }

  process.stderr.write(`Wrote ${outPath} (target: ${adapter.id}).\n`);
}

main();
