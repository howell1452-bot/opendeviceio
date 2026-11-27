// Document checks and re-stamping for registry submissions (provenance brief,
// item 4). Pure helpers, unit-tested in test/submission-doc.test.ts.

/** Largest accepted request body for POST /api/v1/submissions. */
export const MAX_SUBMISSION_BYTES = 512 * 1024;

/** The registry id shape: "<manufacturer-slug>/<model-slug>[@<variant>]" (schema v0.1). */
export const RECORD_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*)?$/;

/** URL-style slug of a (normalized) manufacturer name: "Extron Electronics" -> "extron-electronics". */
export function manufacturerSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The manufacturer part of a record id ("crestron/dm-md8x8" -> "crestron"). */
export function idPrefix(id: string): string {
  return id.split("/")[0] ?? "";
}

/**
 * Does the id's prefix match the document's (normalized) manufacturer? Compared
 * hyphen-insensitively, so "lightware/…" matches "Lightware" and
 * "audio-technica/…" matches "Audio-Technica".
 */
export function idMatchesManufacturer(id: string, manufacturer: string): boolean {
  const prefix = idPrefix(id).replace(/-/g, "");
  const slug = manufacturerSlug(manufacturer).replace(/-/g, "");
  return prefix.length > 0 && prefix === slug;
}

type Json = Record<string, unknown>;

/**
 * Strip and re-stamp provenance.validation for a community or design-vendor
 * submission: whatever the file claims is discarded and replaced with
 * `{ status: "draft" }` (no `by`, no date). provenance.method, generator and
 * sourceDocuments are kept as the submitter's description. A document without
 * a provenance block gets one holding just the validation (schema v0.1 requires
 * no other provenance field). Returns a deep clone.
 */
export function restampAsDraft<T>(doc: T): T {
  const clone = JSON.parse(JSON.stringify(doc)) as Json;
  const provenance = clone.provenance;
  const base =
    provenance && typeof provenance === "object" && !Array.isArray(provenance)
      ? (provenance as Json)
      : {};
  clone.provenance = { ...base, validation: { status: "draft" } };
  return clone as T;
}

/** The status a file claims for itself (informational only; never trusted). */
export function claimedValidationStatus(doc: unknown): string | null {
  const v = (doc as { provenance?: { validation?: { status?: unknown } } } | null)?.provenance
    ?.validation?.status;
  return typeof v === "string" ? v : null;
}
