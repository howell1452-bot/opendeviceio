import { NextResponse } from "next/server";
import { getRegistryRow } from "@/lib/registry";

// Raw .odio.json download for a registry entry. Served at request time so it never
// depends on the DB at build. The catch-all id segment carries the slash, e.g.
// /registry/download/lightware/ucx-4x2-hc60d.
//
// (Lives under /registry/download/[...id] rather than /registry/[...id]/download
// because a catch-all segment must be the last part of a route.)
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string[] }> }
) {
  const { id: segments } = await params;
  const id = (segments ?? []).map((s) => decodeURIComponent(s)).join("/");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const row = await getRegistryRow(id);
  if (!row) {
    return NextResponse.json({ error: "not found", id }, { status: 404 });
  }

  const filename = `${id.replace(/\//g, "_")}.odio.json`;
  const body = JSON.stringify(row.document, null, 2);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
