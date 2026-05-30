import type { OdioDocument } from "@opendeviceio/sdk";
import { normalizeManufacturer } from "@opendeviceio/sdk";
import type { RegistryRow } from "./registry";

// Mirrors the registry-row metadata derivation in tools/seed-registry.mjs so
// manufacturer-published documents land in `public.registry` with the exact
// same shape as the seeded corpus. Keep these two in sync.

// Deep-collect every string value stored under the given keys, anywhere in the doc.
function collectByKey(
  node: unknown,
  keys: string[],
  acc: Set<string> = new Set()
): Set<string> {
  if (Array.isArray(node)) {
    for (const v of node) collectByKey(v, keys, acc);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (keys.includes(k) && typeof v === "string") acc.add(v);
      else collectByKey(v, keys, acc);
    }
  }
  return acc;
}

type AnyDoc = Record<string, unknown> & {
  kind?: string;
  id?: string;
  device?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  cable?: Record<string, unknown>;
  ports?: unknown[];
  odioVersion?: string;
  provenance?: {
    validation?: { status?: string };
  };
};

/** The kind of an ODIO document (device documents carry no top-level `kind`). */
export function documentKind(doc: OdioDocument): "device" | "bundle" | "cable" {
  const k = (doc as AnyDoc).kind;
  if (k === "bundle") return "bundle";
  if (k === "cable") return "cable";
  return "device";
}

/** The identity sub-object for the document (device / bundle / cable). */
function identityOf(doc: OdioDocument): Record<string, unknown> | undefined {
  const d = doc as AnyDoc;
  const kind = documentKind(doc);
  if (kind === "bundle") return d.bundle;
  if (kind === "cable") return d.cable;
  return d.device;
}

/**
 * The manufacturer named inside the document, from its identity sub-object
 * (device.manufacturer / bundle.manufacturer / cable.manufacturer). Trimmed;
 * null when absent.
 */
export function documentManufacturer(doc: OdioDocument): string | null {
  const m = identityOf(doc)?.manufacturer;
  return typeof m === "string" && m.trim() ? m.trim() : null;
}

/**
 * Derive the full registry row (matching tools/seed-registry.mjs) for a
 * validated ODIO document. The caller supplies the validated `kind`.
 */
export function deriveRegistryRow(
  doc: OdioDocument,
  kind: "device" | "bundle" | "cable"
): RegistryRow {
  const d = doc as AnyDoc;
  const identity = identityOf(doc);
  const id = typeof d.id === "string" ? d.id : "";
  const validation = d.provenance?.validation?.status ?? null;
  const portCount =
    kind === "device" && Array.isArray(d.ports) ? d.ports.length : null;
  const connectors = [...collectByKey(doc, ["connector"])].sort();
  const transports = [...collectByKey(doc, ["transport"])].sort();
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  // Canonicalize the manufacturer (same rule as seed) so a publisher's brand
  // variant folds into the existing facet, and the stored document matches.
  const manufacturer = normalizeManufacturer(str(identity?.manufacturer));
  if (identity && manufacturer && identity.manufacturer !== manufacturer) {
    identity.manufacturer = manufacturer;
  }
  return {
    id,
    kind,
    manufacturer,
    model: str(identity?.model),
    category: str(identity?.category),
    product_line: str(identity?.productLine),
    sku: str(identity?.sku),
    validation_status:
      (validation as RegistryRow["validation_status"]) ?? null,
    odio_version: str(d.odioVersion),
    port_count: portCount,
    connectors,
    transports,
    document: doc
  };
}

/**
 * Stamp manufacturer-verified provenance onto a document, recording the
 * verifying user's email. Returns a shallow-cloned document; does not mutate
 * the input.
 */
export function stampManufacturerVerified(
  doc: OdioDocument,
  by: string
): OdioDocument {
  const clone = JSON.parse(JSON.stringify(doc)) as AnyDoc;
  const provenance =
    (clone.provenance as Record<string, unknown> | undefined) ?? {};
  const validation =
    (provenance.validation as Record<string, unknown> | undefined) ?? {};
  clone.provenance = {
    ...provenance,
    validation: {
      ...validation,
      status: "manufacturer-verified",
      by
    }
  } as AnyDoc["provenance"];
  return clone as OdioDocument;
}
