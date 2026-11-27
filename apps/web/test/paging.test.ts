// /registry paging (registry paging brief, item 1): the helpers, the query the
// page sends, the pager it renders, and the 404 past the last page.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listingQuery, pageCount, pageNumber, pageWindow, showingLabel, REGISTRY_PAGE_SIZE } from "../lib/paging";

const calls: Array<Record<string, unknown>> = [];
const state = { total: 2591 };

vi.mock("@/lib/registry", () => ({
  listRegistry: async (q: Record<string, unknown>) => {
    calls.push(q);
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 0);
    const n = Math.max(0, Math.min(limit, state.total - offset));
    return {
      rows: Array.from({ length: n }, (_, i) => ({
        id: `b/r${offset + i}`,
        kind: "device",
        manufacturer: "B",
        model: `R${offset + i}`,
        validation_status: "draft",
        source_type: "machine-draft",
        source_org: null,
        category: null,
        port_count: 0
      })),
      total: state.total,
      unavailable: false
    };
  },
  getFacets: async () => ({ kinds: [], manufacturers: [], categories: [], connectors: [] })
}));
vi.mock("@/lib/brands", () => ({ listBrands: async () => [] }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams()
}));

const page = await import("../app/registry/page");
const { Pager } = await import("../components/Pager");

/** The Pager element in a rendered (unexpanded) server component tree. */
function findPager(node: ReactNode): ReactElement<Parameters<typeof Pager>[0]> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findPager(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === Pager) return node as ReactElement<Parameters<typeof Pager>[0]>;
  return findPager((node.props as { children?: ReactNode }).children);
}

async function render(sp: Record<string, string>) {
  return page.default({ searchParams: Promise.resolve(sp) });
}

beforeEach(() => {
  calls.length = 0;
  state.total = 2591;
});

describe("paging helpers", () => {
  it("reads ?page=N, falling back to 1", () => {
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber(["4", "9"])).toBe(4);
    for (const bad of [undefined, "", "0", "-1", "abc", "2.5", "1e3", " "]) expect(pageNumber(bad)).toBe(1);
  });

  it("counts pages", () => {
    expect(pageCount(2591, 100)).toBe(26);
    expect(pageCount(2600, 100)).toBe(26);
    expect(pageCount(0, 100)).toBe(1);
  });

  it("shows first, last and current ± 2 with gaps", () => {
    expect(pageWindow(1, 26)).toEqual([1, 2, 3, "gap", 26]);
    expect(pageWindow(10, 26)).toEqual([1, "gap", 8, 9, 10, 11, 12, "gap", 26]);
    expect(pageWindow(26, 26)).toEqual([1, "gap", 24, 25, 26]);
    // A gap that would hide one page shows the page.
    expect(pageWindow(5, 26)).toEqual([1, 2, 3, 4, 5, 6, 7, "gap", 26]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it("labels the window", () => {
    expect(showingLabel(2, 100, 2591)).toBe("Showing 101–200 of 2,591");
    expect(showingLabel(26, 100, 2591)).toBe("Showing 2,501–2,591 of 2,591");
    expect(showingLabel(1, 100, 0)).toBe("Showing 0 of 0");
  });

  it("builds listing URLs with page 1 implicit", () => {
    expect(listingQuery({ manufacturer: "QSC", page: 2 })).toBe("?manufacturer=QSC&page=2");
    expect(listingQuery({ manufacturer: "QSC", page: 1 })).toBe("?manufacturer=QSC");
    expect(listingQuery({ q: "", page: 1 })).toBe("");
  });
});

describe("/registry", () => {
  it("asks for one page of 100 with an exact total", async () => {
    await render({ page: "3" });
    expect(REGISTRY_PAGE_SIZE).toBe(100);
    expect(calls[0]).toMatchObject({ limit: 100, offset: 200 });
  });

  it("renders a pager whose links keep every filter and change only the page", async () => {
    const sp = {
      q: "amp",
      kind: "device",
      manufacturer: "QSC",
      category: "av/audio",
      connector: "rj45",
      status: "unverified",
      source: "machine-draft",
      page: "2"
    };
    const pager = findPager(await render(sp));
    expect(pager?.props).toMatchObject({ page: 2, pages: 26, total: 2591, pageSize: 100 });
    const url = new URL(pager!.props.href(3), "https://opendeviceio.org");
    expect(url.pathname).toBe("/registry");
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...sp, page: "3" });
    // Page 1 drops ?page but keeps the filters.
    expect(new URL(pager!.props.href(1), "https://opendeviceio.org").searchParams.get("page")).toBeNull();
    expect(new URL(pager!.props.href(1), "https://opendeviceio.org").searchParams.get("manufacturer")).toBe("QSC");
  });

  it("serves the last page and 404s past it", async () => {
    const last = findPager(await render({ page: "26" }));
    expect(last?.props.page).toBe(26);
    expect(calls.at(-1)).toMatchObject({ offset: 2500, limit: 100 });
    await expect(render({ page: "27" })).rejects.toThrow("NOT_FOUND");
  });

  it("treats an invalid page as page 1, and an empty result as page 1 (not a 404)", async () => {
    await render({ page: "nope" });
    expect(calls.at(-1)).toMatchObject({ offset: 0 });
    state.total = 0;
    await expect(render({ manufacturer: "Nobody" })).resolves.toBeTruthy();
    await expect(render({ manufacturer: "Nobody", page: "2" })).rejects.toThrow("NOT_FOUND");
  });
});
