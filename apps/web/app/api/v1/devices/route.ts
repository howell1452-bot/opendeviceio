import { NextResponse } from "next/server";
import { listRegistry } from "@/lib/registry";
import { validateDocument, type OdioDocument } from "@opendeviceio/sdk";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase-server";
import { membershipsForUser } from "@/lib/membership";
import { hashToken } from "@/lib/tokens";
import {
  deriveRegistryRow,
  documentManufacturer,
  stampManufacturerVerified
} from "@/lib/odio-row";
import {
  LICENSE_LINK_HEADER,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  LIST_MAX_LIMIT_WITH_DOCUMENTS,
  VALIDATION_STATUSES,
  apiUrl,
  licenseEnvelope,
  registryUrl
} from "@/lib/data-license";

// REST API for the registry.
//   GET  — public, read-only list / search / export (CORS-enabled).
//   POST — authenticated write (cookie session OR Bearer token). Publishes a
//          manufacturer-verified document the caller is scoped to.
// Resolved at request time so `next build` never touches the DB, and a missing
// or unreachable DB degrades to an empty result set (never a 500) on GET.
export const dynamic = "force-dynamic";

// Permissive CORS so the GET API is callable from any tool / browser origin.
// POST is same-origin (cookie) or Bearer; it still tolerates preflight.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Link",
  "Cache-Control": "no-store",
  Link: LICENSE_LINK_HEADER
};

function clampInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * List / search / export.
 *
 * Integration parameters (all optional, all additive to the original API):
 *   status         comma-separated validation statuses
 *                  (draft, reviewed, manufacturer-verified)
 *   updated_since  ISO 8601 timestamp; rows with updated_at >= it
 *   sort           "name" (default) | "updated" (updated_at, id — for sync)
 *   include        "document" embeds the full .odio document in each row
 *                  (page size capped at LIST_MAX_LIMIT_WITH_DOCUMENTS)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  // ---- status -------------------------------------------------------------
  let statuses: string[] | undefined;
  const statusParam = sp.get("status");
  if (statusParam != null && statusParam.trim() !== "") {
    statuses = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = statuses.filter(
      (s) => !(VALIDATION_STATUSES as readonly string[]).includes(s)
    );
    if (bad.length > 0) {
      return err(
        400,
        `Unknown status: ${bad.join(", ")}. Use one or more of: ${VALIDATION_STATUSES.join(", ")}.`
      );
    }
  }

  // ---- updated_since ------------------------------------------------------
  let updatedSince: string | undefined;
  const sinceParam = sp.get("updated_since");
  if (sinceParam != null && sinceParam.trim() !== "") {
    const t = Date.parse(sinceParam);
    if (Number.isNaN(t)) {
      return err(
        400,
        "updated_since must be an ISO 8601 timestamp, e.g. 2026-11-01T00:00:00Z."
      );
    }
    updatedSince = new Date(t).toISOString();
  }

  // ---- sort ---------------------------------------------------------------
  const sortParam = sp.get("sort") ?? "name";
  if (sortParam !== "name" && sortParam !== "updated") {
    return err(400, 'sort must be "name" or "updated".');
  }

  // ---- include ------------------------------------------------------------
  const includeParam = sp.get("include");
  if (includeParam != null && includeParam !== "" && includeParam !== "document") {
    return err(400, 'include must be "document".');
  }
  const includeDocument = includeParam === "document";

  const maxLimit = includeDocument ? LIST_MAX_LIMIT_WITH_DOCUMENTS : LIST_MAX_LIMIT;
  const limit = clampInt(sp.get("limit"), Math.min(LIST_DEFAULT_LIMIT, maxLimit), 1, maxLimit);
  const offset = clampInt(sp.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  const { rows, total } = await listRegistry({
    search: sp.get("q") ?? undefined,
    manufacturer: sp.get("manufacturer") ?? undefined,
    category: sp.get("category") ?? undefined,
    kind: sp.get("kind") ?? undefined,
    connector: sp.get("connector") ?? undefined,
    transport: sp.get("transport") ?? undefined,
    statuses,
    updatedSince,
    sort: sortParam,
    includeDocument,
    limit,
    offset
  });

  const data = rows.map((row) => ({
    ...row,
    registry_url: registryUrl(row.id),
    api_url: apiUrl(row.id)
  }));

  return NextResponse.json(
    { data, total: total ?? 0, limit, offset, ...licenseEnvelope() },
    { headers: CORS_HEADERS }
  );
}

function err(status: number, message: string, extra?: unknown) {
  return NextResponse.json(
    { error: message, ...(extra ? { details: extra } : {}) },
    { status, headers: CORS_HEADERS }
  );
}

/**
 * Authenticated write: publish a manufacturer-verified ODIO document.
 *
 * Auth (either):
 *   (a) cookie session  -> use the user's authenticated client; RLS enforces
 *       that the row's manufacturer is in the user's manufacturer_members.
 *   (b) Authorization: Bearer <token> -> sha256-hash, look up api_tokens, load
 *       that user's memberships, verify the doc's manufacturer in code, then
 *       upsert via the SERVICE client and bump last_used_at.
 *
 * 400 invalid doc, 401 missing/invalid auth, 403 manufacturer out of scope.
 */
export async function POST(req: Request) {
  // Parse + validate the body first (same for both auth modes).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err(400, "Request body is not valid JSON.");
  }

  const validation = validateDocument(body);
  if (!validation.valid) {
    return err(
      400,
      "Document failed ODIO schema validation.",
      validation.errors.map((e) =>
        e.path ? `${e.path}: ${e.message}` : e.message
      )
    );
  }
  const doc = body as OdioDocument;
  const manufacturer = documentManufacturer(doc);
  if (!manufacturer) {
    return err(400, "Document does not name a manufacturer.");
  }
  const docId = (doc as { id?: unknown }).id;
  if (typeof docId !== "string" || !docId) {
    return err(400, "Document has no id.");
  }

  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && /^Bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^Bearer\s+/i, "").trim()
      : null;

  // ---- Mode (b): Bearer token -> service-client upsert -----------------------
  if (bearer) {
    const service = getServiceSupabase();
    if (!service) return err(401, "Token auth is not configured.");

    const token_hash = hashToken(bearer);
    const { data: tokenRow, error: tokenErr } = await service
      .from("api_tokens")
      .select("id,user_id")
      .eq("token_hash", token_hash)
      .maybeSingle();
    if (tokenErr || !tokenRow) return err(401, "Invalid API token.");

    const userId = (tokenRow as { user_id: string }).user_id;
    const brands = await membershipsForUser(service, userId);
    if (!brands.includes(manufacturer)) {
      return err(
        403,
        `Manufacturer "${manufacturer}" is not in your approved brands.`
      );
    }

    const stamped = stampManufacturerVerified(doc, manufacturer);
    const row = deriveRegistryRow(stamped, validation.kind);

    const { error: upErr } = await service.from("registry").upsert(
      {
        id: row.id,
        kind: row.kind,
        manufacturer: row.manufacturer,
        model: row.model,
        category: row.category,
        product_line: row.product_line,
        sku: row.sku,
        validation_status: "manufacturer-verified",
        odio_version: row.odio_version,
        port_count: row.port_count,
        connectors: row.connectors,
        transports: row.transports,
        document: row.document
      },
      { onConflict: "id" }
    );
    if (upErr) return err(400, `Publish failed: ${upErr.message}`);

    // Bump last_used_at (best-effort).
    await service
      .from("api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", (tokenRow as { id: string }).id);

    return NextResponse.json(
      { id: row.id, status: "manufacturer-verified" },
      { headers: CORS_HEADERS }
    );
  }

  // ---- Mode (a): cookie session -> user-client upsert (RLS scopes it) --------
  const client = await getServerSupabase();
  if (!client) return err(401, "Authentication required.");
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return err(401, "Authentication required.");

  const stamped = stampManufacturerVerified(doc, manufacturer);
  const row = deriveRegistryRow(stamped, validation.kind);

  const { error: upErr } = await client.from("registry").upsert(
    {
      id: row.id,
      kind: row.kind,
      manufacturer: row.manufacturer,
      model: row.model,
      category: row.category,
      product_line: row.product_line,
      sku: row.sku,
      validation_status: "manufacturer-verified",
      odio_version: row.odio_version,
      port_count: row.port_count,
      connectors: row.connectors,
      transports: row.transports,
      document: row.document
    },
    { onConflict: "id" }
  );
  if (upErr) {
    // RLS violation surfaces here when the manufacturer is out of the user's
    // scope; report it as a 403.
    const msg = upErr.message || "";
    if (/row-level security|policy|not authorized|permission/i.test(msg)) {
      return err(
        403,
        `Manufacturer "${manufacturer}" is not in your approved brands.`
      );
    }
    return err(400, `Publish failed: ${msg}`);
  }

  return NextResponse.json(
    { id: row.id, status: "manufacturer-verified" },
    { headers: CORS_HEADERS }
  );
}
