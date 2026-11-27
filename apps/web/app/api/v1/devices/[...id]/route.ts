import { NextResponse } from "next/server";
import type { OdioDevice } from "@opendeviceio/sdk";
import { buildDevicePrograms, buildIoTable, renderTableSvg } from "@opendeviceio/adapters";
import {
  getRegistryRow,
  listPublicRevisions,
  type RegistryRow
} from "@/lib/registry";
import {
  LICENSE_LINK_HEADER,
  apiUrl,
  licenseEnvelope,
  registryUrl
} from "@/lib/data-license";

// Public, read-only REST API: fetch one ODIO document by id, or a render-ready
// projection via ?format= :
//   (default)  the raw .odio document (JSON syntax), with the registry's
//              metadata in ODIO-* response headers
//   record     the registry record as JSON: validation_status, source_type,
//              source_org, revision_id, revision_count, ... and the document
//   draw       host-agnostic DrawProgram(s) for native CAD/Visio/InDesign add-ins
//   table      the standardized I/O-table model (JSON)
//   svg        the standardized I/O table rendered as an SVG
// The catch-all segment carries the slash inside an id, e.g.
// /api/v1/devices/lightware/ucx-4x2-hc60d?format=draw.
//
// GET /api/v1/devices/{id}/revisions lists the record's public history
// (published and superseded revisions, newest first; no submitter identity).
// Record ids have exactly one slash, so a third "revisions" segment is never
// part of an id.
// Resolved at request time; a missing / unreachable DB returns 404.
export const dynamic = "force-dynamic";

const META_HEADERS = [
  "ODIO-Validation-Status",
  "ODIO-Source-Type",
  "ODIO-Source-Org",
  "ODIO-Revision-Id",
  "ODIO-Revision-Count"
];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": ["Link", ...META_HEADERS].join(", "),
  "Cache-Control": "no-store",
  Link: LICENSE_LINK_HEADER
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS_HEADERS });
}

/**
 * Registry metadata as response headers. The default body is the .odio file
 * itself, which is never altered. ODIO-Source-Org is percent-encoded UTF-8.
 */
function metaHeaders(row: RegistryRow, revisionCount: number): Record<string, string> {
  return {
    "ODIO-Validation-Status": row.validation_status ?? "draft",
    "ODIO-Source-Type": row.source_type ?? "machine-draft",
    ...(row.source_org ? { "ODIO-Source-Org": encodeURIComponent(row.source_org) } : {}),
    ...(row.revision_id ? { "ODIO-Revision-Id": row.revision_id } : {}),
    "ODIO-Revision-Count": String(revisionCount)
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string[] }> }
) {
  const { id: raw } = await params;
  const segments = (raw ?? []).map((s) => decodeURIComponent(s));
  const sp = new URL(req.url).searchParams;

  // ---- /{id}/revisions ----------------------------------------------------
  if (segments.length === 3 && segments[2] === "revisions") {
    const id = segments.slice(0, 2).join("/");
    const row = await getRegistryRow(id);
    if (!row) return notFound();
    const includeDocument = sp.get("include") === "document";
    const revisions = (await listPublicRevisions(id, { includeDocument })) ?? [];
    return NextResponse.json(
      {
        record_id: id,
        data: revisions.map((r) => ({ ...r, is_current: r.revision_id === row.revision_id })),
        total: revisions.length,
        ...licenseEnvelope()
      },
      { headers: CORS_HEADERS }
    );
  }

  const id = segments.join("/");
  if (!id) return notFound();

  const row = await getRegistryRow(id);
  if (!row) return notFound();

  const doc = row.document as OdioDevice;
  const format = sp.get("format");

  try {
    if (format === "draw") {
      return json(buildDevicePrograms(doc));
    }
    if (format === "table") {
      return json(buildIoTable(doc));
    }
    if (format === "svg") {
      return new NextResponse(renderTableSvg(buildIoTable(doc)), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "image/svg+xml; charset=utf-8" }
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "render failed", format, detail: (err as Error).message },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const revisionCount = ((await listPublicRevisions(id)) ?? []).length;

  if (format === "record") {
    const { document, ...meta } = row;
    return NextResponse.json(
      {
        ...meta,
        revision_count: revisionCount,
        registry_url: registryUrl(row.id),
        api_url: apiUrl(row.id),
        document,
        ...licenseEnvelope()
      },
      { headers: CORS_HEADERS }
    );
  }

  // Default: the full ODIO document (the row's `document` column) verbatim.
  return new NextResponse(JSON.stringify(doc), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...metaHeaders(row, revisionCount),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function json(payload: unknown): NextResponse {
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}
