import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, parse, OdioValidationError } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "examples");
const invalidDir = path.join(examplesDir, "invalid");

function odioFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".odio.json"))
    .map((f) => path.join(dir, f));
}

function load(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("valid example corpus", () => {
  const files = odioFiles(examplesDir);

  it("finds the valid examples", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)("%s validates as valid", (file) => {
    const result = validate(load(file));
    if (!result.valid) {
      throw new Error(
        `${file} should be valid but had errors:\n` +
          result.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")
      );
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it.each(files)("%s round-trips through parse()", (file) => {
    const device = parse(readFileSync(file, "utf8"));
    expect(device.odioVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(device.ports.length).toBeGreaterThan(0);
  });
});

describe("invalid example corpus", () => {
  const files = odioFiles(invalidDir);

  it("finds the invalid examples", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)("%s validates as invalid", (file) => {
    const result = validate(load(file));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it.each(files)("%s makes parse() throw a readable error", (file) => {
    expect(() => parse(readFileSync(file, "utf8"))).toThrow(OdioValidationError);
    try {
      parse(readFileSync(file, "utf8"));
    } catch (e) {
      expect(e).toBeInstanceOf(OdioValidationError);
      expect((e as OdioValidationError).message).toContain("Invalid OpenDeviceIO document");
      expect((e as OdioValidationError).errors.length).toBeGreaterThan(0);
    }
  });
});

describe("parse()", () => {
  it("throws SyntaxError on malformed JSON", () => {
    expect(() => parse("{ not json")).toThrow(SyntaxError);
  });
});
