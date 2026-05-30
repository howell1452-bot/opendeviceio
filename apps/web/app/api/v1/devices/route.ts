import { NextResponse } from "next/server";
import { listRegistry } from "@/lib/registry";

// Public, read-only REST API: list / search the registry.
// Resolved at request time so `next build` never touches the DB, and a missing
// or unreachable DB degrades to an empty result set (never a 500).
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Permissive CORS so the API is callable from any tool / browser origin.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
