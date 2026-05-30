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

// REST API for the registry.
//   GET  — public, read-only list / search (CORS-enabled).
//   POST — authenticated write (cookie session OR Bearer token). Publishes a
//          manufacturer-verified document the caller is scoped to.
// Resolved at request time so `next build` never touches the DB, and a missing
// or unreachable DB degrades to an empty result set (never a 500) on GET.
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Permissive CORS so the GET API is callable from any tool / browser origin.
// POST is same-origin (cookie) or Bearer; it still tolerates preflight.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const limit = clampInt(sp.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(sp.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  const { rows, total } = await listRegistry({
    search: sp.get("q") ?? undefined,
    manufacturer: sp.get("manufacturer") ?? undefined,
    category: sp.get("category") ?? undefined,
    kind: sp.get("kind") ?? undefined,
    connector: sp.get("connector") ?? undefined,
    transport: sp.get("transport") ?? undefined,
    limit,
    offset
  });

  return NextResponse.json(
    { data: rows, total: total ?? 0, limit, offset },
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

    // Best-effort: stamp provenance with the token owner's email if we have it.
    let by = "api-token";
    try {
      const { data: au } = await service.auth.admin.getUserById(userId);
      if (au?.user?.email) by = au.user.email;
    } catch {
      /* email is optional */
    }

    const stamped = stampManufacturerVerified(doc, by);
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

  const stamped = stampManufacturerVerified(doc, auth.user.email ?? auth.user.id);
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
