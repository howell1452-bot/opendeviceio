// Items 8–9: source labels, the list API's additive fields and source=
// filter, and the by-id endpoint's headers, ?format=record and /revisions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_FILTERS, SOURCE_TYPES, sourceLabel } from "../lib/source";

const ROW = {
  id: "acme/dsp-1212",
  kind: "device",
  manufacturer: "Acme",
  model: "DSP-1212",
  category: "av/audio/dsp",
  product_line: null,
  sku: null,
  validation_status: "draft",
  odio_version: "0.1.0",
  port_count: 2,
  connectors: ["rj45"],
  transports: ["dante"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  source_type: "design-vendor",
  source_org: "Société Exemple",
  revision_id: "11111111-1111-4111-8111-111111111111"
};

const calls: { list?: Record<string, unknown> } = {};

vi.mock("@/lib/registry", () => ({
  listRegistry: async (q: Record<string, unknown>) => {
    calls.list = q;
    return { rows: [ROW], total: 1, unavailable: false };
  },
  getRevisionCounts: async (ids: string[]) => new Map(ids.map((id) => [id, 3])),
  getRegistryRow: async (id: string) =>
    id === ROW.id ? { ...ROW, document: { id: ROW.id, device: { manufacturer: "Acme", model: "DSP-1212" } } } : null,
  listPublicRevisions: async (id: string, opts: { includeDocument?: boolean } = {}) =>
    id === ROW.id
      ? [
          {
            revision_id: ROW.revision_id,
            status: "published",
            source_type: "design-vendor",
            source_org: "Société Exemple",
            created_at: "2026-01-02T00:00:00Z",
            ...(opts.includeDocument ? { document: { id: ROW.id } } : {})
          },
          {
            revision_id: "22222222-2222-4222-8222-222222222222",
            status: "superseded",
            source_type: "machine-draft",
            source_org: null,
            created_at: "2026-01-01T00:00:00Z"
          }
        ]
      : []
}));

const list = await import("../app/api/v1/devices/route");
const byId = await import("../app/api/v1/devices/[...id]/route");

const params = (id: string) => ({ params: Promise.resolve({ id: id.split("/") }) });

beforeEach(() => {
  calls.list = undefined;
});

describe("source labels", () => {
  it("never name a person", () => {
    expect(sourceLabel("machine-draft")).toBe("Machine draft");
    expect(sourceLabel("community")).toBe("Community submission");
    expect(sourceLabel("design-vendor", "Example Co")).toBe("Design vendor · Example Co");
    expect(sourceLabel("design-vendor", null)).toBe("Design vendor");
    expect(sourceLabel("manufacturer")).toBe("Manufacturer");
    expect(sourceLabel(null)).toBe("Machine draft");
  });
  it("filters cover every source type", () => {
    expect(SOURCE_FILTERS.map((f) => f.value)).toEqual([...SOURCE_TYPES]);
  });
});

describe("GET /api/v1/devices", () => {
  it("keeps every existing field and adds source_type, source_org, revision_id, revision_count", async () => {
    const res = await list.GET(new Request("https://opendeviceio.org/api/v1/devices?limit=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; total: number };
    const row = body.data[0];
    for (const k of [
      "id", "kind", "manufacturer", "model", "category", "product_line", "sku",
      "validation_status", "odio_version", "port_count", "connectors", "transports",
      "created_at", "updated_at", "registry_url", "api_url"
    ]) {
      expect(row).toHaveProperty(k);
    }
    expect(row).toMatchObject({
      source_type: "design-vendor",
      source_org: "Société Exemple",
      revision_id: ROW.revision_id,
      revision_count: 3,
      validation_status: "draft"
    });
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["data", "total", "limit", "offset", "license", "terms_url", "attribution"])
    );
  });

  it("passes a validated source= filter, combinable with status=", async () => {
    const res = await list.GET(
      new Request("https://opendeviceio.org/api/v1/devices?status=draft&source=community,design-vendor")
    );
    expect(res.status).toBe(200);
    expect(calls.list).toMatchObject({ statuses: ["draft"], sources: ["community", "design-vendor"] });
  });

  it("400 on an unknown source", async () => {
    const res = await list.GET(new Request("https://opendeviceio.org/api/v1/devices?source=robots"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("machine-draft, community");
  });
});

describe("GET /api/v1/devices/{id}", () => {
  it("returns the .odio document verbatim, with registry metadata in headers", async () => {
    const res = await byId.GET(new Request(`https://opendeviceio.org/api/v1/devices/${ROW.id}`), params(ROW.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ROW.id, device: { manufacturer: "Acme", model: "DSP-1212" } });
    expect(res.headers.get("ODIO-Validation-Status")).toBe("draft");
    expect(res.headers.get("ODIO-Source-Type")).toBe("design-vendor");
    expect(decodeURIComponent(res.headers.get("ODIO-Source-Org") ?? "")).toBe("Société Exemple");
    expect(res.headers.get("ODIO-Revision-Id")).toBe(ROW.revision_id);
    expect(res.headers.get("ODIO-Revision-Count")).toBe("2");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("ODIO-Source-Type");
  });

  it("?format=record returns the record JSON with the new fields and the document", async () => {
    const res = await byId.GET(
      new Request(`https://opendeviceio.org/api/v1/devices/${ROW.id}?format=record`),
      params(ROW.id)
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: ROW.id,
      validation_status: "draft",
      source_type: "design-vendor",
      source_org: "Société Exemple",
      revision_id: ROW.revision_id,
      revision_count: 2
    });
    expect(body.document).toBeTruthy();
  });

  it("/revisions lists public history without submitter identity", async () => {
    const res = await byId.GET(
      new Request(`https://opendeviceio.org/api/v1/devices/${ROW.id}/revisions`),
      params(`${ROW.id}/revisions`)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record_id: string; total: number; data: Array<Record<string, unknown>> };
    expect(body.record_id).toBe(ROW.id);
    expect(body.total).toBe(2);
    expect(body.data[0]).toMatchObject({ is_current: true, status: "published" });
    expect(body.data[1]).toMatchObject({ is_current: false, status: "superseded" });
    for (const r of body.data) {
      expect(Object.keys(r).sort()).toEqual(
        ["created_at", "is_current", "revision_id", "source_org", "source_type", "status"].sort()
      );
    }
  });

  it("404 for an unknown id and for its revisions", async () => {
    expect((await byId.GET(new Request("https://x/api/v1/devices/no/such"), params("no/such"))).status).toBe(404);
    expect(
      (await byId.GET(new Request("https://x/api/v1/devices/no/such/revisions"), params("no/such/revisions"))).status
    ).toBe(404);
  });
});
