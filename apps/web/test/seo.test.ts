// Canonical URLs, noindex, sitemap.xml, robots.txt and the preview-host
// X-Robots-Tag rule (canonical/SEO brief). The rendered tags and content types
// are checked end to end in e2e/seo.spec.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { FakeDb } from "./helpers/fake-supabase";

const state: { db: FakeDb } = { db: new FakeDb() };

const ROW = (id: string, status = "draft") => ({
  id,
  kind: "device",
  manufacturer: "Attero Tech",
  model: "Axiom ML1",
  validation_status: status,
  source_type: "machine-draft",
  source_org: null,
  revision_id: null,
  document: { id, device: { manufacturer: "Attero Tech", model: "Axiom ML1" }, ports: [] }
});
const LIVE = new Map([
  ["attero-tech/axiom-ml1", ROW("attero-tech/axiom-ml1")],
  ["lightware/ucx-4x2", ROW("lightware/ucx-4x2", "reviewed")]
]);
const REDIRECTS = new Map([["attero-tech-by-qsc/axiom-ml1", "attero-tech/axiom-ml1"]]);

vi.mock("@/lib/registry", async (orig) => ({
  ...(await orig<typeof import("../lib/registry")>()),
  getRegistryRow: async (id: string) => LIVE.get(id) ?? null,
  listPublicRevisions: async () => []
}));
vi.mock("@/lib/redirects", async (orig) => {
  const real = await orig<typeof import("../lib/redirects")>();
  return { ...real, resolveRedirect: async (id: string) => real.applyRedirect(id, REDIRECTS) };
});
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.db.client() }));
class Redirected extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    throw new Redirected(url);
  },
  redirect: (url: string) => {
    throw new Redirected(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  }
}));

const { SITE_URL, absoluteUrl } = await import("../lib/site");
const recordPage = await import("../app/registry/[...id]/page");
const brandPage = await import("../app/brands/[slug]/page");
const { buildSitemap, loadSitemap, SITEMAP_STATIC_PATHS } = await import("../lib/sitemap");
const { buildRobots } = await import("../lib/robots");

/** The canonical URL as Next renders it: resolved against metadataBase. */
function canonicalOf(m: Metadata): string | null {
  const c = m.alternates?.canonical;
  if (!c) return null;
  return new URL(String(c), SITE_URL).href;
}

function seedBrand(slug: string, manufacturer: string) {
  state.db.t("organizations_public").push({
    id: `org-${slug}`,
    kind: "manufacturer",
    name: manufacturer,
    slug,
    manufacturer,
    claimed_at: null,
    description: null,
    website: null,
    support_url: null,
    data_contact: null
  });
}

beforeEach(() => {
  state.db = new FakeDb();
});

describe("site origin", () => {
  it("is opendeviceio.org, and the layout resolves metadata against it", async () => {
    expect(SITE_URL).toBe("https://opendeviceio.org");
    const layout = await import("../app/layout");
    expect(String(layout.metadata.metadataBase)).toBe("https://opendeviceio.org/");
  });
});

describe("record pages", () => {
  it("canonicalize to the current id, with og:url to match", async () => {
    const m = await recordPage.generateMetadata({ params: Promise.resolve({ id: ["attero-tech", "axiom-ml1"] }) });
    expect(canonicalOf(m)).toBe("https://opendeviceio.org/registry/attero-tech/axiom-ml1");
    expect(m.openGraph?.url).toBe("/registry/attero-tech/axiom-ml1");
    // Unverified drafts stay noindex (P0-4); reviewed records are indexable.
    expect(m.robots).toMatchObject({ index: false });
    const reviewed = await recordPage.generateMetadata({ params: Promise.resolve({ id: ["lightware", "ucx-4x2"] }) });
    expect(reviewed.robots).toBeUndefined();
    expect(canonicalOf(reviewed)).toBe("https://opendeviceio.org/registry/lightware/ucx-4x2");
  });

  it("an old id 308s to the new id, whose canonical is the new id (no query string)", async () => {
    await expect(
      recordPage.default({
        params: Promise.resolve({ id: ["attero-tech-by-qsc", "axiom-ml1"] }),
        searchParams: Promise.resolve({ tab: "io" })
      })
    ).rejects.toMatchObject({ url: "/registry/attero-tech/axiom-ml1?tab=io" });
    const m = await recordPage.generateMetadata({ params: Promise.resolve({ id: ["attero-tech", "axiom-ml1"] }) });
    expect(canonicalOf(m)).toBe("https://opendeviceio.org/registry/attero-tech/axiom-ml1");
  });

  it("a missing record carries no canonical", async () => {
    const m = await recordPage.generateMetadata({ params: Promise.resolve({ id: ["no", "such"] }) });
    expect(m.alternates).toBeUndefined();
  });
});

describe("brand pages", () => {
  const meta = (page?: string, extra: Record<string, string> = {}) =>
    brandPage.generateMetadata({
      params: Promise.resolve({ slug: "crestron" }),
      searchParams: Promise.resolve({ ...(page ? { page } : {}), ...extra })
    });

  beforeEach(() => seedBrand("crestron", "Crestron"));

  it("canonicalize to /brands/<slug>, with og:url to match", async () => {
    const m = await meta();
    expect(canonicalOf(m)).toBe("https://opendeviceio.org/brands/crestron");
    expect(m.openGraph?.url).toBe("/brands/crestron");
  });

  it("keep ?page=N past page 1 and drop filters", async () => {
    expect(canonicalOf(await meta("3", { status: "draft", category: "av/audio" }))).toBe(
      "https://opendeviceio.org/brands/crestron?page=3"
    );
    expect(canonicalOf(await meta("1"))).toBe("https://opendeviceio.org/brands/crestron");
    expect(canonicalOf(await meta("nonsense"))).toBe("https://opendeviceio.org/brands/crestron");
    expect(canonicalOf(await meta(undefined, { status: "reviewed" }))).toBe("https://opendeviceio.org/brands/crestron");
  });
});

describe("listing and static pages", () => {
  it("/registry: page 1 is the plain listing, page N keeps ?page=N, filters are dropped", async () => {
    const { generateMetadata } = await import("../app/registry/page");
    const meta = (sp: Record<string, string>) => generateMetadata({ searchParams: Promise.resolve(sp) });
    expect(canonicalOf(await meta({}))).toBe("https://opendeviceio.org/registry");
    expect(canonicalOf(await meta({ manufacturer: "QSC", q: "amp" }))).toBe("https://opendeviceio.org/registry");
    expect(canonicalOf(await meta({ page: "3" }))).toBe("https://opendeviceio.org/registry?page=3");
    expect(canonicalOf(await meta({ brand: "qsc", manufacturer: "QSC", page: "3" }))).toBe(
      "https://opendeviceio.org/registry?page=3"
    );
    expect(canonicalOf(await meta({ page: "1" }))).toBe("https://opendeviceio.org/registry");
    expect(canonicalOf(await meta({ page: "-2" }))).toBe("https://opendeviceio.org/registry");
    expect(canonicalOf(await meta({ page: "abc" }))).toBe("https://opendeviceio.org/registry");
  });

  it.each([
    ["/", "../app/page"],
    ["/manufacturers", "../app/manufacturers/page"],
    ["/implement", "../app/implement/page"],
    ["/about", "../app/about/page"],
    ["/guide", "../app/guide/page"],
    ["/whitepaper", "../app/whitepaper/page"],
    ["/tools", "../app/tools/page"],
    ["/correct", "../app/correct/page"],
    ["/data-license", "../app/data-license/page"],
    ["/api-docs", "../app/api-docs/page"],
    ["/brands", "../app/brands/page"]
  ])("%s canonicalizes to itself", async (path, mod) => {
    const { metadata } = (await import(mod)) as { metadata: Metadata };
    expect(canonicalOf(metadata)).toBe(new URL(path, SITE_URL).href);
    expect(metadata.robots).toBeUndefined();
  });
});

describe("pages behind sign-in", () => {
  it.each([
    "../app/brands/[slug]/manage/page",
    "../app/admin/page",
    "../app/submit/page",
    "../app/publish/page",
    "../app/author/page",
    "../app/account/page",
    "../app/signin/page"
  ])("%s is noindex", async (mod) => {
    const { metadata } = (await import(mod)) as { metadata: Metadata };
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("a brand's claim page is noindex", async () => {
    seedBrand("crestron", "Crestron");
    const claim = await import("../app/brands/[slug]/claim/page");
    const m = await claim.generateMetadata({ params: Promise.resolve({ slug: "crestron" }) } as never);
    expect(m.robots).toMatchObject({ index: false });
  });
});

describe("sitemap.xml", () => {
  const records = [
    { id: "attero-tech/axiom-ml1", manufacturer: "Attero Tech", updated_at: "2026-11-27T19:14:08Z" },
    { id: "attero-tech/und4o", manufacturer: "Attero Tech", updated_at: "2026-11-27T19:14:09Z" },
    { id: "crestron/dm-md8x8", manufacturer: "Crestron", updated_at: "2026-05-30T20:52:41Z" }
  ];
  const brands = [
    { slug: "crestron", manufacturer: "Crestron" },
    { slug: "attero-tech", manufacturer: "Attero Tech" },
    { slug: "empty-brand", manufacturer: "Empty Brand" }
  ];

  it("lists the static pages, brands with records, and records under their ids", () => {
    const urls = buildSitemap(records, brands).map((e) => e.url);
    for (const p of SITEMAP_STATIC_PATHS) expect(urls).toContain(absoluteUrl(p));
    expect(urls).toContain("https://opendeviceio.org/brands/crestron");
    expect(urls).toContain("https://opendeviceio.org/brands/attero-tech");
    expect(urls).not.toContain("https://opendeviceio.org/brands/empty-brand");
    expect(urls).toContain("https://opendeviceio.org/registry/attero-tech/axiom-ml1");
    expect(new Set(urls).size).toBe(urls.length);
    // Nothing behind sign-in and no API routes.
    const PRIVATE = /^\/(admin|api|submit|publish|author|account|signin)(\/|$)|^\/brands\/[^/]+\/(manage|claim|export)$/;
    expect(urls.map((u) => new URL(u).pathname).filter((p) => PRIVATE.test(p))).toEqual([]);
  });

  it("takes lastModified from updated_at (a brand: its newest record)", () => {
    const entries = buildSitemap(records, brands);
    const rec = entries.find((e) => e.url.endsWith("/registry/attero-tech/axiom-ml1"));
    expect(rec?.lastModified).toEqual(new Date("2026-11-27T19:14:08Z"));
    const brand = entries.find((e) => e.url.endsWith("/brands/attero-tech"));
    expect(brand?.lastModified).toEqual(new Date("2026-11-27T19:14:09Z"));
  });

  it("reads the live registry as anon: current ids only, never a redirected old id", async () => {
    for (const r of records) state.db.t("registry").push({ ...r });
    state.db.t("record_redirects").push({ old_id: "attero-tech-by-qsc/axiom-ml1", new_id: "attero-tech/axiom-ml1" });
    seedBrand("attero-tech", "Attero Tech");
    seedBrand("crestron", "Crestron");
    const urls = (await loadSitemap()).map((e) => e.url);
    expect(urls).toContain("https://opendeviceio.org/registry/attero-tech/axiom-ml1");
    expect(urls).toContain("https://opendeviceio.org/brands/crestron");
    expect(urls.some((u) => u.includes("attero-tech-by-qsc"))).toBe(false);
  });

  it("still serves the static pages when the database is unreachable", async () => {
    state.db = new FakeDb();
    const urls = (await loadSitemap()).map((e) => e.url);
    expect(urls).toEqual(SITEMAP_STATIC_PATHS.map((p) => absoluteUrl(p)));
  });
});

describe("robots.txt", () => {
  it("allows the site, points at the sitemap and keeps private paths out", () => {
    const r = buildRobots();
    expect(r.sitemap).toBe("https://opendeviceio.org/sitemap.xml");
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    for (const p of ["/admin", "/api/", "/brands/*/manage", "/brands/*/claim", "/submit", "/publish", "/author"]) {
      expect(rule.disallow).toContain(p);
    }
  });
});

describe("preview hosts", () => {
  it("send X-Robots-Tag: noindex on every host but opendeviceio.org", async () => {
    const config = (await import("../next.config.mjs")).default as {
      headers: () => Promise<Array<{ source: string; missing?: Array<{ type: string; value: string }>; headers: Array<{ key: string; value: string }> }>>;
    };
    const rule = (await config.headers()).find((h) => h.headers.some((x) => x.key === "X-Robots-Tag"));
    expect(rule?.source).toBe("/:path*");
    expect(rule?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
    // Next matches has/missing values as ^value$ against the lowercased hostname.
    const host = rule?.missing?.find((m) => m.type === "host");
    const prod = new RegExp(`^${host?.value}$`);
    expect(prod.test("opendeviceio.org")).toBe(true);
    expect(prod.test("www.opendeviceio.org")).toBe(true);
    for (const preview of ["opendeviceio-web.vercel.app", "opendeviceio-git-x-y.vercel.app", "localhost", "evil-opendeviceio.org"]) {
      expect(prod.test(preview)).toBe(false);
    }
  });
});
