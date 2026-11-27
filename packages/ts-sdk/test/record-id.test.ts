import { describe, expect, it } from "vitest";
import {
  brandSlug,
  checkIdPrefix,
  expectedIdPrefix,
  normalizeManufacturer,
  normalizeRecordId,
  RETIRED_ID_PREFIXES,
  withBrandPrefix
} from "../src/index.js";

describe("normalizeRecordId", () => {
  it("rewrites a retired prefix and keeps the rest of the id", () => {
    expect(normalizeRecordId("attero-tech-by-qsc/axiom-ml1")).toBe("attero-tech/axiom-ml1");
    expect(normalizeRecordId("attero-tech-by-qsc/und6io@2")).toBe("attero-tech/und6io@2");
  });

  it("leaves current and unknown prefixes alone", () => {
    expect(normalizeRecordId("attero-tech/axiom-ml1")).toBe("attero-tech/axiom-ml1");
    expect(normalizeRecordId("crestron/dm-md8x8")).toBe("crestron/dm-md8x8");
    expect(normalizeRecordId("acme-labs/x1")).toBe("acme-labs/x1");
    expect(normalizeRecordId("attero-tech-by-qsc")).toBe("attero-tech-by-qsc");
    expect(normalizeRecordId(null)).toBeNull();
    expect(normalizeRecordId(undefined)).toBeUndefined();
  });

  it("is idempotent and maps to a current prefix", () => {
    for (const [old, current] of Object.entries(RETIRED_ID_PREFIXES)) {
      expect(RETIRED_ID_PREFIXES[current]).toBeUndefined();
      const once = normalizeRecordId(`${old}/x`);
      expect(normalizeRecordId(once)).toBe(once);
    }
  });
});

// Registry paging and ID cleanup brief, item 4: the prefix is the brand slug.
describe("brand slugs and id prefixes", () => {
  it("brandSlug matches the SQL private.brand_slug() for every brand in the registry", () => {
    const cases: Record<string, string> = {
      "1Beyond": "1beyond",
      "Attero Tech": "attero-tech",
      ClearOne: "clearone",
      Crestron: "crestron",
      DIS: "dis",
      "Extreme Networks": "extreme-networks",
      NETGEAR: "netgear",
      QSC: "qsc",
      "Stem Audio": "stem-audio",
      USL: "usl",
      "New Brand & Co": "new-brand-and-co",
      "  --Odd__Name--  ": "odd-name",
      // Accents: the same cases as supabase/tests/16_id_cleanup.test.sql.
      "Société Générale": "societe-generale",
      "İstanbul Ses": "istanbul-ses",
      "Cafe\u0301 Audio": "cafe-audio",
      Ørsted: "rsted"
    };
    for (const [name, slug] of Object.entries(cases)) expect(brandSlug(name)).toBe(slug);
  });

  it("maps every alias in the brief to qsc, usl or dis", () => {
    const cases: Record<string, string> = {
      "Q-SYS": "qsc",
      QSYS: "qsc",
      "QSC Audio": "qsc",
      "QSC Audio Products": "qsc",
      "QSC Audio Products, LLC": "qsc",
      "USL Inc": "usl",
      "USL, Inc.": "usl",
      "US L Inc": "usl",
      "Ultra Stereo Labs": "usl",
      "US Linc": "usl",
      "DIS Digital Conference Systems": "dis",
      "Attero Tech by QSC": "attero-tech",
      "Extreme Networks": "extreme-networks"
    };
    for (const [name, prefix] of Object.entries(cases)) expect(expectedIdPrefix(name)).toBe(prefix);
    expect(normalizeManufacturer("Q-SYS")).toBe("QSC");
    expect(normalizeManufacturer("Ultra Stereo Labs")).toBe("USL");
  });

  it("flags every old prefix from the 0013 cleanup", () => {
    const cases: Array<[string, string, string]> = [
      ["qsys/ad-c6t-zb", "QSC", "qsc/ad-c6t-zb"],
      ["qsys/core-110f@v2", "QSC", "qsc/core-110f@v2"],
      ["qsc-audio/cx6t", "QSC", "qsc/cx6t"],
      ["qsc-audio-products/cx4", "QSC", "qsc/cx4"],
      ["uslinc/cm-10b", "USL", "usl/cm-10b"],
      ["us-linc/dat-100", "USL", "usl/dat-100"],
      ["usl-inc/jsd", "USL", "usl/jsd"],
      ["dis-digital-conference-systems/dm-6680-f", "DIS", "dis/dm-6680-f"],
      ["crestron/cen-extrm-220-24p-kit", "Extreme Networks", "extreme-networks/cen-extrm-220-24p-kit"]
    ];
    for (const [id, manufacturer, fixed] of cases) {
      const m = checkIdPrefix(id, manufacturer);
      expect(m?.suggestedId).toBe(fixed);
      expect(m?.message).toBe(`id prefix '${id.split("/")[0]}' doesn't match brand slug '${fixed.split("/")[0]}'`);
      expect(withBrandPrefix(id, manufacturer)).toBe(fixed);
      expect(checkIdPrefix(fixed, manufacturer)).toBeNull();
    }
  });

  it("accepts matching ids, compares with a stored slug when given, and skips records without a manufacturer", () => {
    expect(checkIdPrefix("qsc/core-110f", "QSC")).toBeNull();
    expect(checkIdPrefix("qsc/core-110f", "QSC Audio Products, LLC")).toBeNull();
    expect(checkIdPrefix("acme-a1b2c3/x", "Acme", "acme-a1b2c3")).toBeNull();
    expect(checkIdPrefix("acme/x", "Acme", "acme-a1b2c3")?.expected).toBe("acme-a1b2c3");
    expect(checkIdPrefix("anything/x", null)).toBeNull();
    expect(withBrandPrefix("attero-tech-by-qsc/x", null)).toBe("attero-tech/x");
    expect(withBrandPrefix(null, "QSC")).toBeNull();
  });
});
