import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistryRow } from "./registry";

// The one place registry rows are written. Server-only: callers pass the
// service client (clients have no write grant on public.registry, and a guard
// trigger rejects client-role writes; see 0007_provenance_tiers.sql).

export type SourceType = "machine-draft" | "community" | "design-vendor" | "manufacturer";

export const SOURCE_TYPES: readonly SourceType[] = [
  "machine-draft",
  "community",
  "design-vendor",
  "manufacturer"
];

export interface WriteMeta {
  sourceType: SourceType;
  sourceOrgId?: string | null;
  currentRevisionId?: string | null;
}

/** Upsert a derived registry row with its source metadata. */
export async function writeRegistryRow(
  service: SupabaseClient,
  row: RegistryRow,
  meta: WriteMeta
): Promise<{ error: string | null }> {
  const { error } = await service.from("registry").upsert(
    {
      id: row.id,
      kind: row.kind,
      manufacturer: row.manufacturer,
      model: row.model,
      category: row.category,
      product_line: row.product_line,
      sku: row.sku,
      validation_status: row.validation_status ?? "draft",
      odio_version: row.odio_version,
      port_count: row.port_count,
      connectors: row.connectors,
      transports: row.transports,
      document: row.document,
      source_type: meta.sourceType,
      source_org_id: meta.sourceOrgId ?? null,
      ...(meta.currentRevisionId !== undefined
        ? { current_revision_id: meta.currentRevisionId }
        : {})
    },
    { onConflict: "id" }
  );
  return { error: error ? error.message : null };
}
