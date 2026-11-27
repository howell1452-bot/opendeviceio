// Record source (who submitted it), kept apart from verification (who vouched
// for it). Shared by the registry list, the record page, the filters and the
// API. Pure: safe in client and server code.

export type SourceType = "machine-draft" | "community" | "design-vendor" | "manufacturer";

export const SOURCE_TYPES: readonly SourceType[] = [
  "machine-draft",
  "community",
  "design-vendor",
  "manufacturer"
];

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === "string" && (SOURCE_TYPES as readonly string[]).includes(v);
}

/**
 * Public label for a source. Attribution is an organization name or the
 * generic "Community submission"; never a person.
 */
export function sourceLabel(type: string | null | undefined, orgName?: string | null): string {
  switch (type) {
    case "community":
      return "Community submission";
    case "design-vendor":
      return orgName ? `Design vendor · ${orgName}` : "Design vendor";
    case "manufacturer":
      return "Manufacturer";
    default:
      return "Machine draft";
  }
}

/** Registry `?source=` filter values (the API's `source=` takes the raw source types). */
export const SOURCE_FILTERS: ReadonlyArray<{ value: SourceType; label: string }> = [
  { value: "machine-draft", label: "Machine draft" },
  { value: "community", label: "Community submission" },
  { value: "design-vendor", label: "Design vendor" },
  { value: "manufacturer", label: "Manufacturer" }
];
