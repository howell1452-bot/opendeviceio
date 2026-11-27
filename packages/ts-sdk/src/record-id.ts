// Record id normalization.
//
// Registry ids look like "<manufacturer-slug>/<model-slug>[@<variant>]". When a
// brand's id prefix is corrected (for example "attero-tech-by-qsc" became
// "attero-tech"), the registry renames the records and keeps redirects, and
// every tool that writes ids rewrites the retired prefix so it can't come back.
// The list lives in vocab/id-prefixes.json (bundled by scripts/gen-types.mjs);
// Genie reads the same file.

import { RETIRED_ID_PREFIXES } from "./id-prefix-vocab.js";
import { normalizeManufacturer } from "./manufacturer.js";

export { RETIRED_ID_PREFIXES };

const RETIRED: ReadonlyMap<string, string> = new Map(Object.entries(RETIRED_ID_PREFIXES));

/**
 * The id with a retired prefix replaced by its current one. Anything else
 * (including null/undefined and ids without a slash) is returned unchanged.
 */
export function normalizeRecordId<T extends string | null | undefined>(id: T): T {
  if (typeof id !== "string") return id;
  const slash = id.indexOf("/");
  if (slash <= 0) return id;
  const current = RETIRED.get(id.slice(0, slash));
  return (current ? `${current}${id.slice(slash)}` : id) as T;
}

// ---------------------------------------------------------------------------
// Id prefix = brand slug
// ---------------------------------------------------------------------------
// A record id's prefix is the brand slug of its manufacturer: the canonical
// brand name (normalizeManufacturer) slugged the way the database slugs it
// (private.brand_slug in 0010_brand_profiles.sql, stored as
// organizations.slug). The database rejects any other prefix
// (id_prefix_mismatch, 0013_record_id_cleanup.sql); importers derive the prefix
// from here instead of trusting free text.


/**
 * Slug of a brand name, identical to the SQL private.brand_slug(): accents
 * stripped (Unicode NFD, combining marks removed), lowercase, "&" -> " and ",
 * every run of characters other than a-z and 0-9 -> "-", trimmed of "-".
 * "Stem Audio" -> "stem-audio", "New Brand & Co" -> "new-brand-and-co",
 * "Société Générale" -> "societe-generale".
 */
export function brandSlug(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The id prefix a record of this manufacturer must use, or null without a manufacturer. */
export function expectedIdPrefix(manufacturer: string | null | undefined): string | null {
  const canonical = normalizeManufacturer(manufacturer ?? "");
  const slug = brandSlug(canonical);
  return slug || null;
}

/** The prefix of a record id ("qsc/core-110f@v2" -> "qsc"). */
export function idPrefix(id: string): string {
  const slash = id.indexOf("/");
  return slash < 0 ? "" : id.slice(0, slash);
}

/** The id with its prefix replaced (an id without a slash is returned unchanged). */
export function replaceIdPrefix(id: string, prefix: string): string {
  const slash = id.indexOf("/");
  return slash <= 0 ? id : `${prefix}${id.slice(slash)}`;
}

export interface IdPrefixMismatch {
  prefix: string;
  expected: string;
  /** The same id under the expected prefix. */
  suggestedId: string;
  /** "id prefix 'qsys' doesn't match brand slug 'qsc'" */
  message: string;
}

/**
 * Null when the id's prefix is the brand slug of the manufacturer (pass
 * `expected` to compare with a stored organizations.slug instead), otherwise
 * what's wrong and the id it should have.
 */
export function checkIdPrefix(
  id: string,
  manufacturer: string | null | undefined,
  expected: string | null = expectedIdPrefix(manufacturer)
): IdPrefixMismatch | null {
  if (!expected) return null;
  const prefix = idPrefix(id);
  if (prefix === expected) return null;
  return {
    prefix,
    expected,
    suggestedId: replaceIdPrefix(id, expected),
    message: `id prefix '${prefix}' doesn't match brand slug '${expected}'`
  };
}

/**
 * For machine importers: the id under its manufacturer's brand slug (retired
 * prefixes and free-text prefixes alike). Unchanged without a manufacturer.
 */
export function withBrandPrefix<T extends string | null | undefined>(
  id: T,
  manufacturer: string | null | undefined
): T {
  if (typeof id !== "string") return id;
  const expected = expectedIdPrefix(manufacturer);
  if (!expected || id.indexOf("/") <= 0) return normalizeRecordId(id);
  return replaceIdPrefix(id, expected) as T;
}
