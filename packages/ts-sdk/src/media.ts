// File-format identity for OpenDeviceIO documents.
//
// An ODIO document is JSON. Its canonical on-disk form uses the `.odio` extension
// (the legacy `.odio.json` is still accepted during the transition). The content
// is unchanged either way, so every JSON tool — this SDK, validators, `jq`, the
// registry — works regardless of which extension a file carries.

/** IANA-style media type for an ODIO JSON document. */
export const ODIO_MEDIA_TYPE = "application/vnd.odio+json";

/** Canonical file extension (with leading dot). */
export const ODIO_EXTENSION = ".odio";

/** Legacy file extension, accepted during the transition. */
export const ODIO_LEGACY_EXTENSION = ".odio.json";

/** Current ODIO format/spec version. */
export const ODIO_VERSION = "0.1.0";

/**
 * True if `path` names an ODIO document by extension (`.odio` or `.odio.json`).
 * Case-insensitive. Note: ODIO content is JSON, so a plain `.json` file may also
 * be a valid document — this only checks the recommended extensions.
 */
export function isOdioPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(ODIO_EXTENSION) || p.endsWith(ODIO_LEGACY_EXTENSION);
}

/**
 * Suggest a canonical `<base>.odio` filename from a slug/id, stripping any
 * existing `.odio`/`.odio.json`/`.json` extension first.
 */
export function odioFilename(base: string): string {
  const stripped = base.replace(/\.odio\.json$|\.odio$|\.json$/i, "");
  return `${stripped}${ODIO_EXTENSION}`;
}
