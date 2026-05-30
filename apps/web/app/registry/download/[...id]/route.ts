import { NextResponse } from "next/server";
import type { OdioDevice } from "@opendeviceio/sdk";
import { getAdapter } from "@opendeviceio/adapters";
import { getRegistryRow } from "@/lib/registry";

// Multi-format download for a registry entry. Served at request time so it never
// depends on the DB at build. The catch-all id segment carries the slash, e.g.
// /registry/download/lightware/ucx-4x2-hc60d.
//
// (Lives under /registry/download/[...id] rather than /registry/[...id]/download
// because a catch-all segment must be the last part of a route.)
//
// Format is selected via ?format= :
//   odio         (default) — the raw .odio.json document
//   easyschematic          — EasySchematic bulk-import JSON
//   dxf                    — AutoCAD DXF (text)
//   svg                    — standardized ODIO I/O table (SVG; opens in any browser)
//
// Bundles are expanded internally by each adapter, so this works for devices,
// bundles, and cables alike.
export const dynamic = "force-dynamic";

type Format = "odio" | "easyschematic" | "dxf" | "svg";

// adapter id (in @opendeviceio/adapters) + the download metadata per format.
const FORMATS: Record<
  Exclude<Format, "odio">,
  { adapterId: string; contentType: string; ext: string }
> = {
  easyschematic: {
    adapterId: "easyschematic",
    contentType: "application/json; charset=utf-8",
    ext: "easyschematic.json"
  },
  dxf: {
    adapterId: "dxf",
    contentType: "application/dxf",
    ext: "dxf"
  },
  svg: {
    adapterId: "table-svg",
    contentType: "image/svg+xml; charset=utf-8",
    ext: "io-table.svg"
  }
};

function isFormat(v: string | null): v is Format {
  return v === "odio" || v === "easyschematic" || v === "dxf" || v === "svg";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string[] }> }
) {
  const { id: segments } = await params;
  const id = (segments ?? []).map((s) => decodeURIComponent(s)).join("/");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const fmtParam = new URL(req.url).searchParams.get("format");
  const format: Format = isFormat(fmtParam) ? fmtParam : "odio";
  const slug = id.replace(/\//g, "_");

  const row = await getRegistryRow(id);
  if (!row) {
    return NextResponse.json({ error: "not found", id }, { status: 404 });
  }

  // Raw ODIO document — the original behaviour, no adapter involved.
  if (format === "odio") {
    return new NextResponse(JSON.stringify(row.document, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.odio.json"`,
        "Cache-Control": "no-store"
      }
    });
  }

  const spec = FORMATS[format];
  const adapter = getAdapter(spec.adapterId);
  if (!adapter) {
    return NextResponse.json(
      { error: "unsupported format", format },
      { status: 400 }
    );
  }

  let file;
  try {
    // The adapter accepts device/bundle/cable documents and routes internally;
    // the OdioDevice cast satisfies the Adapter signature.
    const result = adapter.export(row.document as unknown as OdioDevice);
    file = result.files[0];
    if (!file) {
      throw new Error("adapter produced no output files");
    }
  } catch (err) {
    return NextResponse.json(
      { error: "export failed", format, detail: (err as Error).message },
      { status: 500 }
    );
  }

  const filename = `${slug}.${spec.ext}`;
  const headers = {
    "Content-Type": spec.contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  };

  if (file.bytes) {
    // Binary target (VSDX zip): return bytes verbatim, never utf8-encoded.
    return new NextResponse(Buffer.from(file.bytes), { status: 200, headers });
  }
  return new NextResponse(file.content ?? "", { status: 200, headers });
}
