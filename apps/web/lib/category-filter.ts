// Registry category filter on top of the controlled vocabulary (vocab/).
//
// Stored `category` values are still the raw paths importers produced (the
// one-off rewrite in tools/rewrite-categories.mjs has not been run). The
// website's Category filter therefore lists controlled paths only, and a
// selected controlled path matches every raw spelling that maps to it in
// vocab/category-map.json, plus the controlled path itself.
//
// The public API's `category=` parameter is unchanged (exact match).
import {
  CATEGORY_MAP,
  categoryLabel,
  isControlledCategory,
  normalizeCategory
} from "@opendeviceio/sdk";

const RAW_BY_CONTROLLED: ReadonlyMap<string, readonly string[]> = (() => {
  const out = new Map<string, Set<string>>();
  for (const [from, to] of Object.entries(CATEGORY_MAP)) {
    if (!out.has(to)) out.set(to, new Set([to]));
    out.get(to)!.add(from);
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
})();

/**
 * Raw stored category values a filter on `category` should match. A controlled
 * path expands to itself plus every mapped spelling; anything else (an old link
 * with a raw path) matches exactly.
 */
export function categoryFilterValues(category: string): string[] {
  if (!isControlledCategory(category)) return [category];
  return [...(RAW_BY_CONTROLLED.get(category) ?? [category])];
}

/** The controlled path a stored category falls under, or null if none. */
export function controlledCategoryOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeCategory(raw);
  return isControlledCategory(normalized) ? normalized : null;
}

/** Dropdown text for a controlled path: "Label (path)". */
export function categoryOptionLabel(path: string): string {
  const label = categoryLabel(path);
  return label ? `${label} (${path})` : path;
}
