import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeCategory,
  isControlledCategory,
  categoryLabel,
  CATEGORY_VOCABULARY,
  CATEGORY_MAP,
  CATEGORY_VOCAB_VERSION,
  deviceSchema
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vocabDir = path.resolve(here, "..", "..", "..", "vocab");
const readVocab = (name: string) => JSON.parse(readFileSync(path.join(vocabDir, name), "utf8"));

interface MappingRow {
  from: string;
  to: string;
  count: number;
  review?: boolean;
  note?: string;
}
const categoriesDoc = readVocab("categories.json") as {
  version: string;
  categories: { path: string; label: string }[];
};
const mapDoc = readVocab("category-map.json") as {
  version: string;
  observed: { rows: number; distinctCategories: number; nullCategories: number };
  rules: { segmentSynonyms: Record<string, string>; rootAliases: Record<string, string> };
  mappings: MappingRow[];
};

const CATEGORY_PATTERN = new RegExp(deviceSchema.$defs.device.properties.category.pattern);
const controlled = new Set(CATEGORY_VOCABULARY.map((c) => c.path));

// Shared with genie/tests/test_category.py — keep the two tables in step.
const NEAR_DUPLICATES: [string, string][] = [
  ["av/accessory/mount", "accessory/mount"],
  ["av/accessory/mounting", "accessory/mount"],
  ["av/accessory/mount-kit", "accessory/mount"],
  ["av/accessories/mounting", "accessory/mount"],
  ["av/amplifier/multichannel", "av/amplifier/power"],
  ["av/amplifier/multi-channel", "av/amplifier/power"],
  ["av/control/touch-screen", "control/touch-panel"],
  ["av/control/touchscreen", "control/touch-panel"],
  ["av/control/touchpanel", "control/touch-panel"],
  ["av/speaker/in-ceiling", "av/loudspeaker/ceiling"],
  ["av/loudspeaker/ceiling", "av/loudspeaker/ceiling"]
];

const UNSEEN: [string, string][] = [
  ["AV/Accessories/Mounts", "accessory/mount"],
  [" av / speakers / in-ceiling ", "av/loudspeaker/ceiling"],
  ["Av/Control/Touch Screens", "control/touch-panel"],
  ["av/amplifiers/multi_channel", "av/amplifier/power"],
  ["av/control/keypads", "control/keypad"],
  ["audio/speaker/in-wall", "av/loudspeaker/in-wall"],
  ["hvac/thermostats", "control/thermostat"],
  ["av/lighting/dimmers", "lighting/dimmer"],
  ["building/sensor/presence-detector", "control/sensor/occupancy"],
  ["it/power/psu", "power/supply"],
  ["av/conferencing/video-bars", "av/conferencing/video-bar"],
  ["av/wall-plates", "accessory/wall-plate"],
  // Unknown but valid: left alone (only the light segment rules apply).
  ["av/widget/frobnicator", "av/widget/frobnicator"],
  ["it/storage/nas", "it/storage/nas"],
  ["av/assembly", "av/assembly"],
  ["av/speaker/horn", "av/loudspeaker/horn"],
  ["constructor", "constructor"],
  ["av/constructor/hasownproperty", "av/constructor/hasownproperty"]
];

describe("category vocabulary", () => {
  it("is non-trivial and within the intended size", () => {
    expect(CATEGORY_VOCABULARY.length).toBeGreaterThanOrEqual(60);
    expect(CATEGORY_VOCABULARY.length).toBeLessThanOrEqual(120);
  });

  it("has unique paths that match the schema's category pattern, each with a label", () => {
    expect(controlled.size).toBe(CATEGORY_VOCABULARY.length);
    for (const { path: p, label } of CATEGORY_VOCABULARY) {
      expect(p, p).toMatch(CATEGORY_PATTERN);
      expect(label.trim().length, p).toBeGreaterThan(0);
      expect(p.split("/").length, p).toBeLessThanOrEqual(3);
    }
  });

  it("is in sync with vocab/categories.json and vocab/category-map.json (run gen-types)", () => {
    expect(CATEGORY_VOCAB_VERSION).toBe(categoriesDoc.version);
    expect(CATEGORY_VOCABULARY).toEqual(categoriesDoc.categories);
    expect(CATEGORY_MAP).toEqual(Object.fromEntries(mapDoc.mappings.map((m) => [m.from, m.to])));
  });

  it("has no near-duplicate pairs (same path once hyphens, plurals and synonyms are folded)", () => {
    const syn = mapDoc.rules.segmentSynonyms;
    const fold = (p: string) =>
      p
        .split("/")
        .map((seg) => {
          let k = seg.replace(/-/g, "");
          k = syn[k] ?? k;
          return k.replace(/-/g, "").replace(/(ies|es|s)$/, "");
        })
        .join("/");
    const seen = new Map<string, string>();
    for (const { path: p } of CATEGORY_VOCABULARY) {
      const key = fold(p);
      expect(seen.get(key), `${p} collides with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, p);
    }
  });

  it("exposes labels and membership", () => {
    expect(isControlledCategory("av/amplifier/power")).toBe(true);
    expect(isControlledCategory("av/amplifier/multichannel")).toBe(false);
    expect(isControlledCategory(undefined)).toBe(false);
    expect(categoryLabel("accessory/mount")).toBe("Mount / bracket");
    expect(categoryLabel("nope")).toBeUndefined();
  });
});

describe("category map", () => {
  it("covers every observed production category exactly once", () => {
    const froms = mapDoc.mappings.map((m) => m.from);
    expect(new Set(froms).size).toBe(froms.length);
    expect(froms.length).toBe(mapDoc.observed.distinctCategories);
    const rows = mapDoc.mappings.reduce((n, m) => n + m.count, 0);
    expect(rows + mapDoc.observed.nullCategories).toBe(mapDoc.observed.rows);
  });

  it("maps every entry to a path in the vocabulary", () => {
    const outside = mapDoc.mappings.filter((m) => !controlled.has(m.to));
    expect(outside).toEqual([]);
  });

  it("never remaps a controlled path to a different one", () => {
    for (const m of mapDoc.mappings) {
      if (controlled.has(m.from)) expect(m.to, m.from).toBe(m.from);
    }
  });

  it("collapses production to fewer than 150 distinct categories", () => {
    const after = new Set(mapDoc.mappings.map((m) => m.to));
    expect(after.size).toBeLessThan(150);
  });

  it("flags low-confidence mappings for review", () => {
    const flagged = mapDoc.mappings.filter((m) => m.review);
    expect(flagged.length).toBeGreaterThan(0);
    for (const m of mapDoc.mappings) {
      if (m.note !== undefined) expect(m.review, m.from).toBe(true);
    }
  });
});

describe("normalizeCategory", () => {
  it.each(NEAR_DUPLICATES)("collapses near-duplicate %s -> %s", (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });

  it.each(UNSEEN)("canonicalizes unseen input %j -> %s", (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });

  it("returns the mapped path for every map entry", () => {
    for (const m of mapDoc.mappings) expect(normalizeCategory(m.from), m.from).toBe(m.to);
  });

  it("is the identity on controlled paths", () => {
    for (const p of controlled) expect(normalizeCategory(p)).toBe(p);
  });

  it("is idempotent", () => {
    const inputs = [...mapDoc.mappings.map((m) => m.from), ...UNSEEN.map(([raw]) => raw)];
    for (const raw of inputs) {
      const once = normalizeCategory(raw);
      expect(normalizeCategory(once), raw).toBe(once);
    }
  });

  it("produces schema-valid paths from messy but salvageable input", () => {
    for (const [raw] of UNSEEN) expect(normalizeCategory(raw)).toMatch(CATEGORY_PATTERN);
  });

  it("passes null/undefined through and trims empties", () => {
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeUndefined();
    expect(normalizeCategory("   ")).toBe("");
  });
});
