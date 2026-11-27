import { NextResponse } from "next/server";
import { listRedirects } from "@/lib/redirects";
import {
  LICENSE_LINK_HEADER,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  licenseEnvelope
} from "@/lib/data-license";

// Public, read-only feed of renamed record ids, for integrations that mirror
// the registry.
//   GET /api/v1/redirects?since=<ISO 8601>&limit=&offset=
// Returns { old_id, new_id, created_at } pairs created at or after `since`,
// oldest first. A mirror should re-key its copy of old_id to new_id (the
// record under new_id also comes through updated_since). Renamed ids are not
// in the removals feed.
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Link",
  "Cache-Control": "no-store",
  Link: LICENSE_LINK_HEADER
};

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  let since: string | undefined;
  const sinceParam = sp.get("since");
  if (sinceParam != null && sinceParam.trim() !== "") {
    const t = Date.parse(sinceParam);
    if (Number.isNaN(t)) {
      return NextResponse.json(
        { error: "since must be an ISO 8601 timestamp, e.g. 2026-11-01T00:00:00Z." },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    since = new Date(t).toISOString();
  }

  const limit = clampInt(sp.get("limit"), LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT);
  const offset = clampInt(sp.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  const { rows, total, unavailable } = await listRedirects({ since, limit, offset });
  if (unavailable) {
    return NextResponse.json(
      { error: "The redirects feed is temporarily unavailable." },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { data: rows, total: total ?? 0, limit, offset, ...licenseEnvelope() },
    { headers: CORS_HEADERS }
  );
}
