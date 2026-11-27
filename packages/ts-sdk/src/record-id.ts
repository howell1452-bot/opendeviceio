// Record id normalization.
//
// Registry ids look like "<manufacturer-slug>/<model-slug>[@<variant>]". When a
// brand's id prefix is corrected (for example "attero-tech-by-qsc" became
// "attero-tech"), the registry renames the records and keeps redirects, and
// every tool that writes ids rewrites the retired prefix so it can't come back.
// The list lives in vocab/id-prefixes.json (bundled by scripts/gen-types.mjs);
// Genie reads the same file.

import { RETIRED_ID_PREFIXES } from "./id-prefix-vocab.js";

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
