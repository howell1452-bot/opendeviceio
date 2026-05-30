import { NextResponse } from "next/server";
import type { OdioDevice } from "@opendeviceio/sdk";
import { buildDevicePrograms, buildIoTable, renderTableSvg } from "@opendeviceio/adapters";
import { getRegistryRow } from "@/lib/registry";

// Public, read-only REST API: fetch one ODIO document by id, or a render-ready
// projection via ?format= :
//   (default)  the raw .odio document (JSON)
//   draw       host-agnostic DrawProgram(s) for native CAD/Visio/InDesign add-ins
//   table      the standardized I/O-table model (JSON)
//   svg        the standardized I/O table rendered as an SVG
// The catch-all segment carries the slash inside an id, e.g.
// /api/v1/devices/lightware/ucx-4x2-hc60d?format=draw.
// Resolved at request time; a missing / unreachable DB returns 404.
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string[] }> }
) {
  const { id: segments } = await params;
  const id = (segments ?? []).map((s) => decodeURIComponent(s)).join("/");

  if (!id) {
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const row = await getRegistryRow(id);
  if (!row) {
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const doc = row.document as OdioDevice;
  const format = new URL(_req.url).searchParams.get("format");

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

  // Default: the full ODIO document (the row's `document` column) verbatim.
  return new NextResponse(JSON.stringify(doc), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

function json(payload: unknown): NextResponse {
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}
