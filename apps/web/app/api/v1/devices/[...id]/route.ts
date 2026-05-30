import { NextResponse } from "next/server";
import { getRegistryRow } from "@/lib/registry";

// Public, read-only REST API: fetch one ODIO document by id.
// The catch-all segment carries the slash inside an id, e.g.
// /api/v1/devices/lightware/ucx-4x2-hc60d.
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

  // Return the full ODIO document (the row's `document` column) verbatim.
  return new NextResponse(JSON.stringify(row.document), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
