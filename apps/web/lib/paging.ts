// Server-side paging shared by /registry and brand pages: ?page=N, 1-based.

/** Records per /registry page. */
export const REGISTRY_PAGE_SIZE = 100;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/** The requested page: invalid, non-numeric or < 1 -> 1. */
export function pageNumber(v: string | string[] | undefined): number {
  const raw = first(v).trim();
  if (!/^\d+$/.test(raw)) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/** Number of pages for a total (at least 1, so an empty result is page 1 of 1). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export type PageSlot = number | "gap";

/**
 * The numbered links to show: the first and last page, and the current page
 * ± 2, with a gap where pages are skipped. A gap that would hide a single
 * page shows that page instead.
 */
export function pageWindow(page: number, pages: number, radius = 2): PageSlot[] {
  const want = new Set<number>([1, pages]);
  for (let p = page - radius; p <= page + radius; p++) if (p >= 1 && p <= pages) want.add(p);
  const sorted = [...want].sort((a, b) => a - b);
  const out: PageSlot[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev === 2) out.push(prev + 1);
    else if (p - prev > 2) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

/** "Showing 101–200 of 2,591" (en dash, grouped thousands). */
export function showingLabel(page: number, pageSize: number, total: number): string {
  if (total <= 0) return "Showing 0 of 0";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const fmt = (n: number) => n.toLocaleString("en-US");
  return `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`;
}

/**
 * Query string for a listing URL: the given params with empty values dropped
 * and page 1 left implicit.
 */
export function listingQuery(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "page" && Number(v) <= 1) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
