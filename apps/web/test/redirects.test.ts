// Record id renames (launch fixes item B): the redirect lookup, and the 308s
// from the API, the download route and the record page.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyRedirect, redirectCandidates } from "../lib/redirects";

const REDIRECTS = new Map([
  ["attero-tech-by-qsc/axiom-ml1", "attero-tech/axiom-ml1"],
  ["attero-tech-by-qsc/und6io", "attero-tech/und6io"]
]);
const LIVE = new Set(["attero-tech/axiom-ml1", "attero-tech/und6io"]);

vi.mock("@/lib/redirects", async (orig) => {
  const real = await orig<typeof import("../lib/redirects")>();
  return {
    ...real,
    resolveRedirect: async (id: string) => real.applyRedirect(id, REDIRECTS),
    listRedirects: async () => ({
      rows: [...REDIRECTS].map(([old_id, new_id]) => ({ old_id, new_id, created_at: "2026-11-27T16:00:00.000Z" })),
      total: REDIRECTS.size,
      unavailable: false
    })
  };
});
vi.mock("@/lib/registry", () => ({
  getRegistryRow: async (id: string) =>
    LIVE.has(id)
      ? {
          id,
          kind: "device",
          manufacturer: "Attero Tech",
          model: "X",
          validation_status: "draft",
          source_type: "machine-draft",
          source_org: null,
          revision_id: null,
          document: { id, device: { manufacturer: "Attero Tech", model: "X" }, ports: [] }
        }
      : null,
  listPublicRevisions: async () => []
}));

class Redirected extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    throw new Redirected(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  }
}));

const api = await import("../app/api/v1/devices/[...id]/route");
const download = await import("../app/registry/download/[...id]/route");
const feed = await import("../app/api/v1/redirects/route");
const page = await import("../app/registry/[...id]/page");

const params = (id: string) => ({ params: Promise.resolve({ id: id.split("/") }) });

describe("applyRedirect", () => {
  it("maps an old id to its new id", () => {
    expect(applyRedirect("attero-tech-by-qsc/axiom-ml1", REDIRECTS)).toBe("attero-tech/axiom-ml1");
  });
  it("keeps a @revision suffix", () => {
    expect(applyRedirect("attero-tech-by-qsc/und6io@2", REDIRECTS)).toBe("attero-tech/und6io@2");
    expect(redirectCandidates("attero-tech-by-qsc/und6io@2")).toEqual([
      "attero-tech-by-qsc/und6io@2",
      "attero-tech-by-qsc/und6io"
    ]);
  });
  it("returns null for ids that were never renamed", () => {
    expect(applyRedirect("crestron/dm-md8x8", REDIRECTS)).toBeNull();
    expect(applyRedirect("attero-tech/axiom-ml1", REDIRECTS)).toBeNull();
  });
});

describe("GET /api/v1/devices/<old id>", () => {
  beforeEach(() => undefined);

  it("308s to the new id, keeping the query string", async () => {
    const res = await api.GET(
      new Request("https://opendeviceio.org/api/v1/devices/attero-tech-by-qsc/axiom-ml1?format=record"),
      params("attero-tech-by-qsc/axiom-ml1")
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/api/v1/devices/attero-tech/axiom-ml1?format=record");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("Location");
  });

  it("308s the revisions endpoint too", async () => {
    const res = await api.GET(
      new Request("https://opendeviceio.org/api/v1/devices/attero-tech-by-qsc/und6io/revisions"),
      params("attero-tech-by-qsc/und6io/revisions")
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/api/v1/devices/attero-tech/und6io/revisions");
  });

  it("serves the new id and 404s unknown ids", async () => {
    const ok = await api.GET(
      new Request("https://opendeviceio.org/api/v1/devices/attero-tech/axiom-ml1"),
      params("attero-tech/axiom-ml1")
    );
    expect(ok.status).toBe(200);
    const missing = await api.GET(new Request("https://opendeviceio.org/api/v1/devices/no/such"), params("no/such"));
    expect(missing.status).toBe(404);
  });
});

describe("download route", () => {
  it("308s an old id to the new download, keeping ?format=", async () => {
    const res = await download.GET(
      new Request("https://opendeviceio.org/registry/download/attero-tech-by-qsc/axiom-ml1?format=svg"),
      params("attero-tech-by-qsc/axiom-ml1")
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "https://opendeviceio.org/registry/download/attero-tech/axiom-ml1?format=svg"
    );
  });
});

describe("record page", () => {
  it("permanently redirects an old id, keeping @suffix and query", async () => {
    await expect(
      page.default({
        params: Promise.resolve({ id: ["attero-tech-by-qsc", "und6io@2"] }),
        searchParams: Promise.resolve({ tab: "io" })
      })
    ).rejects.toMatchObject({ url: "/registry/attero-tech/und6io@2?tab=io" });
  });

  it("404s an id that was never renamed", async () => {
    await expect(
      page.default({ params: Promise.resolve({ id: ["no", "such"] }), searchParams: Promise.resolve({}) })
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("GET /api/v1/redirects", () => {
  it("lists id pairs with created_at and the license envelope", async () => {
    const res = await feed.GET(new Request("https://opendeviceio.org/api/v1/redirects?since=2026-11-01T00:00:00Z"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, string>>; total: number; license: unknown };
    expect(body.total).toBe(2);
    expect(body.data[0]).toEqual({
      old_id: "attero-tech-by-qsc/axiom-ml1",
      new_id: "attero-tech/axiom-ml1",
      created_at: "2026-11-27T16:00:00.000Z"
    });
    expect(body.license).toBeTruthy();
  });

  it("400s a bad since", async () => {
    const res = await feed.GET(new Request("https://opendeviceio.org/api/v1/redirects?since=yesterday"));
    expect(res.status).toBe(400);
  });
});
