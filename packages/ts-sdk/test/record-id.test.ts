import { describe, expect, it } from "vitest";
import { normalizeRecordId, RETIRED_ID_PREFIXES } from "../src/index.js";

describe("normalizeRecordId", () => {
  it("rewrites a retired prefix and keeps the rest of the id", () => {
    expect(normalizeRecordId("attero-tech-by-qsc/axiom-ml1")).toBe("attero-tech/axiom-ml1");
    expect(normalizeRecordId("attero-tech-by-qsc/und6io@2")).toBe("attero-tech/und6io@2");
  });

  it("leaves current and unknown prefixes alone", () => {
    expect(normalizeRecordId("attero-tech/axiom-ml1")).toBe("attero-tech/axiom-ml1");
    expect(normalizeRecordId("qsys/core-110f")).toBe("qsys/core-110f");
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
