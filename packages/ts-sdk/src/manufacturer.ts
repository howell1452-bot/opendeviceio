// Manufacturer-name normalization.
//
// Because manufacturers (and the bootstrap importer) enter their own names, the
// same company shows up many ways — "Crestron", "Crestron Electronics",
// "Crestron Electronics, Inc."; "QSC" vs "QSC Audio Products, LLC"; "STEINEL" vs
// "Steinel". Left alone these fragment the registry's manufacturer facet and
// split a brand's devices across several filter entries.
//
// We normalize in two layers, deliberately conservative (a wrong *merge* is worse
// than a missed one — it hides a real, distinct brand):
//   1. `manufacturerKey` — a mechanical comparison key: case-folded, punctuation
//      flattened, and trailing legal-entity suffixes (Inc./LLC/Ltd/GmbH/…) removed.
//      This alone collapses case- and suffix-only variants.
//   2. `MANUFACTURER_ALIASES` — a curated map for brand-word variants the mechanical
//      pass can't safely infer ("QSC Audio Products" → "QSC", "Attero Tech by QSC" →
//      "Attero Tech"). Authoritative; keyed by the mechanical key.
//
// `normalizeManufacturer` returns the canonical display name, or the original
// (trimmed) string unchanged when nothing matches — never a mangled guess.

const LEGAL_SUFFIX =
  /\b(inc|incorporated|llc|l\.?l\.?c|ltd|limited|co|company|corp|corporation|gmbh|ag|sa|s\.?a|srl|bv|kg|plc|pty|llp|lp)\b\.?$/;

/** A mechanical comparison key: case/punctuation-insensitive, legal suffixes stripped. */
export function manufacturerKey(raw: string): string {
  if (!raw) return "";
  let s = raw.normalize("NFKC").toLowerCase();
  s = s.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  // Strip trailing legal-entity suffixes repeatedly ("usl, inc." -> "usl").
  let prev: string;
  do {
    prev = s;
    s = s.replace(LEGAL_SUFFIX, "").trim();
  } while (s !== prev && s.length > 0);
  return s;
}

// Curated canonical names, keyed by `manufacturerKey` of each known variant.
// Add an entry only when the mechanical key can't safely unify the variants.
export const MANUFACTURER_ALIASES: Record<string, string> = {
  // Crestron — "Crestron Electronics[, Inc.]"
  crestron: "Crestron",
  "crestron electronics": "Crestron",
  // QSC — "QSC Audio[ Products][, LLC]"
  qsc: "QSC",
  "qsc audio": "QSC",
  "qsc audio products": "QSC",
  // Attero Tech (a QSC sub-brand kept as its own line)
  "attero tech": "Attero Tech",
  "attero tech by qsc": "Attero Tech",
  // USL / US Linc / US Kinema (cinema-sound brand, now USL)
  usl: "USL",
  "us linc": "USL",
  "us kinema / usl": "USL",
  // Steinel — case-only variant handled by the key, listed for clarity
  steinel: "Steinel",
  // Shure ("Shure Incorporated" / "Shure Inc.")
  shure: "Shure",
  // Example/placeholder fixtures
  acme: "Acme",
  "acme audio": "Acme"
};

/**
 * Canonical display name for a manufacturer string. Returns the trimmed original
 * unchanged when no alias matches (never invents a name). Idempotent.
 */
export function normalizeManufacturer<T extends string | null | undefined>(raw: T): T {
  if (raw == null) return raw;
  const trimmed = String(raw).trim();
  if (!trimmed) return trimmed as T;
  const alias = MANUFACTURER_ALIASES[manufacturerKey(trimmed)];
  return (alias ?? trimmed) as T;
}
