import { NextResponse } from "next/server";
import { loadBrandContext } from "@/lib/brand-access";
import { STATUS_FILTERS } from "@/lib/status-filters";

// Bulk export for a brand's team: every record's .odio document, including
// drafts hidden from the public. Members and admins only.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await loadBrandContext(slug);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { org, service } = res.ctx;

  const status = new URL(req.url).searchParams.get("status") ?? "";
  const filter = STATUS_FILTERS.find((s) => s.value === status);

  const records: Array<{ id: string; validation_status: string | null; source_type: string; document: unknown }> = [];
  for (let from = 0; from < 50000; from += 500) {
    let q = service
      .from("registry")
      .select("id,validation_status,source_type,document")
      .eq("manufacturer", org.manufacturer);
    if (filter) q = q.in("validation_status", [...filter.statuses]);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    records.push(...((data ?? []) as typeof records));
    if (!data || data.length < 500) break;
  }

  return new NextResponse(
    JSON.stringify({ brand: org.name, exported_at: new Date().toISOString(), count: records.length, records }, null, 2),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${org.slug}-records.json"`,
        "Cache-Control": "no-store"
      }
    }
  );
}
