import { describe, expect, it } from "vitest";
import { diffDocuments, flatten, setChange, summarize } from "../lib/doc-diff";

describe("flatten", () => {
  it("produces leaf paths", () => {
    const m = flatten({ a: { b: [1, { c: "x" }] }, e: [], f: {} });
    expect([...m.keys()]).toEqual(["a.b[0]", "a.b[1].c", "e", "f"]);
  });
});

describe("diffDocuments", () => {
  it("reports added, removed and changed paths", () => {
    const before = { id: "acme/x", device: { model: "X" }, ports: [{ connector: "rj45" }] };
    const after = {
      id: "acme/x",
      device: { model: "X2", sku: "X-2" },
      ports: [{ connector: "rj45" }, { connector: "xlr-3-female" }]
    };
    const { lines, total } = diffDocuments(before, after);
    expect(total).toBe(3);
    expect(lines).toEqual([
      { op: "~", path: "device.model", before: '"X"', after: '"X2"' },
      { op: "+", path: "device.sku", after: '"X-2"' },
      { op: "+", path: "ports[1].connector", after: '"xlr-3-female"' }
    ]);
  });

  it("treats a missing base as empty and caps output", () => {
    const after = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const { lines, total } = diffDocuments(null, after, 4);
    expect(total).toBe(10);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.op === "+")).toBe(true);
  });

  it("is empty for identical documents", () => {
    expect(diffDocuments({ a: [1, 2] }, { a: [1, 2] }).total).toBe(0);
  });
});

describe("summarize / setChange", () => {
  it("counts ports and collects connectors and transports", () => {
    const s = summarize({
      ports: [
        { connector: "rj45", transport: "dante" },
        { connector: "xlr-3-female" },
        { connector: "rj45", transport: "aes67" }
      ]
    });
    expect(s).toEqual({
      portCount: 3,
      connectors: ["rj45", "xlr-3-female"],
      transports: ["aes67", "dante"]
    });
    expect(summarize({}).portCount).toBeNull();
  });

  it("splits a set change", () => {
    expect(setChange(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });
});
