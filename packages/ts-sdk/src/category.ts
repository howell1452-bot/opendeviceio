// Category normalization.
//
// `device.category` / `bundle.category` is a free-form taxonomy path under schema
// v0.1 (only the pattern ^[a-z0-9]+(?:/[a-z0-9-]+)*$ is enforced). Importers —
// especially LLM extraction — produce many spellings of the same class:
// "av/accessory/mount", "av/accessory/mounting", "av/accessories/mounting",
// "av/amplifier/multi-channel" vs "av/amplifier/multichannel", and so on. Left
// alone these fragment the registry's category facet.
//
// The advisory controlled vocabulary lives in vocab/ at the repo root and is
// bundled into ./category-vocab.ts by scripts/gen-types.mjs. Normalization is
// deliberately conservative, mirroring normalizeManufacturer (a wrong merge is
// worse than a missed one):
//   1. Exact lookup: a path listed in vocab/category-map.json (every category
//      observed in the registry when the taxonomy was drawn up) maps to its
//      controlled path; a controlled path maps to itself.
//   2. Light canonicalization for unseen inputs: lowercase, tidy separators, then
//      per segment apply the shared synonym table ("mounting"/"mount-kit" ->
//      "mount", "accessories" -> "accessory", "multi-channel" -> "multichannel",
//      "touchscreen" -> "touch-panel", ...) and plural -> singular only when the
//      singular is a known segment. First-segment aliases ("audio" -> "av",
//      "building" -> "control") apply too. If the result is a mapped or controlled
//      path, return it; if dropping a legacy leading domain yields a controlled
//      path ("av/control/keypad" -> "control/keypad"), return that.
//   3. Otherwise return the canonicalized path as-is: an unknown-but-valid path is
//      never snapped to some "nearest" controlled category.
// The Python twin (genie/odio_genie/category.py) reads the same vocab/ files and
// implements the same steps.

import {
  CATEGORY_MAP,
  CATEGORY_ROOT_ALIASES,
  CATEGORY_SEGMENT_SYNONYMS,
  CATEGORY_VOCAB_VERSION,
  CATEGORY_VOCABULARY,
  type CategoryEntry
} from "./category-vocab.js";

export { CATEGORY_MAP, CATEGORY_VOCAB_VERSION, CATEGORY_VOCABULARY, type CategoryEntry };

/** Controlled path -> human label. */
const LABELS: ReadonlyMap<string, string> = new Map(
  CATEGORY_VOCABULARY.map((c) => [c.path, c.label] as const)
);

const compact = (segment: string): string => segment.replace(/-/g, "");

// Maps (not plain-object lookups) so inputs like "constructor" never hit
// Object.prototype.
const PATH_MAP: ReadonlyMap<string, string> = new Map(Object.entries(CATEGORY_MAP));
const SYNONYMS: ReadonlyMap<string, string> = new Map(Object.entries(CATEGORY_SEGMENT_SYNONYMS));
const ROOT_ALIASES: ReadonlyMap<string, string> = new Map(Object.entries(CATEGORY_ROOT_ALIASES));

// Every segment that may appear in a canonical path, keyed by its hyphen-free
// form so "wallplate" finds "wall-plate" and "videobar" finds "video-bar".
const KNOWN_SEGMENTS: ReadonlyMap<string, string> = (() => {
  const known = new Map<string, string>();
  for (const { path } of CATEGORY_VOCABULARY) {
    for (const seg of path.split("/")) known.set(compact(seg), seg);
  }
  for (const seg of SYNONYMS.values()) known.set(compact(seg), seg);
  return known;
})();

/** True when `path` is one of the controlled vocabulary paths. */
export function isControlledCategory(path: string | null | undefined): boolean {
  return path != null && LABELS.has(path);
}

/** Human label for a controlled category path, or undefined. */
export function categoryLabel(path: string | null | undefined): string | undefined {
  return path == null ? undefined : LABELS.get(path);
}

function lookupSegment(key: string): string | undefined {
  return SYNONYMS.get(key) ?? KNOWN_SEGMENTS.get(key);
}

/** Canonical spelling of one path segment (synonyms, hyphenation, safe plurals). */
function canonicalSegment(segment: string): string {
  const key = compact(segment);
  const direct = lookupSegment(key);
  if (direct) return direct;
  // Plural -> singular only when the singular is a known segment or synonym.
  if (key.endsWith("s") && !key.endsWith("ss")) {
    const singulars: string[] = [];
    if (key.endsWith("ies")) singulars.push(`${key.slice(0, -3)}y`);
    if (key.endsWith("es")) singulars.push(key.slice(0, -2));
    singulars.push(key.slice(0, -1));
    for (const s of singulars) {
      const hit = lookupSegment(s);
      if (hit) return hit;
    }
  }
  return segment;
}

/** Lowercase and tidy a raw category into slash-separated [a-z0-9-] segments. */
function clean(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .split("/")
    .map((seg) => seg.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((seg) => seg.length > 0)
    .join("/");
}

function lookupPath(path: string): string | undefined {
  return PATH_MAP.get(path) ?? (LABELS.has(path) ? path : undefined);
}

/**
 * Controlled category path for a raw category string (see the module comment).
 * Returns null/undefined unchanged, a mapped or controlled path when one is
 * known, otherwise the lightly canonicalized input. Idempotent.
 */
export function normalizeCategory<T extends string | null | undefined>(raw: T): T {
  if (raw == null) return raw;
  const trimmed = String(raw).trim();
  const cleaned = clean(trimmed);
  if (!cleaned) return trimmed as T;

  const exact = lookupPath(cleaned);
  if (exact) return exact as T;

  const segments = cleaned.split("/").map(canonicalSegment);
  const rootAlias = ROOT_ALIASES.get(segments[0]);
  if (rootAlias) segments[0] = rootAlias;
  const canonical = segments.join("/");

  const mapped = lookupPath(canonical);
  if (mapped) return mapped as T;

  // Re-root under a controlled domain: "av/control/keypad" -> "control/keypad".
  if (segments.length > 1) {
    const rest = segments.slice(1).join("/");
    if (LABELS.has(rest)) return rest as T;
  }
  return canonical as T;
}
