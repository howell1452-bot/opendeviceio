import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, type OdioDevice } from "@opendeviceio/sdk";
import { DxfAdapter } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../examples");

function loadDevice(name: string): OdioDevice {
  return parse(readFileSync(join(examplesDir, name), "utf8"));
}
function loadRaw(rel: string): OdioDevice {
  return JSON.parse(readFileSync(join(examplesDir, rel), "utf8")) as OdioDevice;
}

function runDxf(device: OdioDevice): string {
  const result = DxfAdapter.export(device);
  return result.files[0].content ?? "";
}

/** Count occurrences of a literal line value following a group-code line. */
function countEntities(dxf: string, type: string): number {
  // ENTITIES/BLOCKS entities are "  0\r\nTYPE". Count exact-line matches.
  const lines = dxf.split(/\r?\n/);
  let n = 0;
  for (const l of lines) if (l === type) n++;
  return n;
}

describe("DXF adapter — structure", () => {
  it("emits the required DXF section markers and EOF", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("HEADER");
    expect(dxf).toContain("TABLES");
    expect(dxf).toContain("BLOCKS");
    expect(dxf).toContain("ENTITIES");
    expect(dxf).toContain("ENDSEC");
    // EOF must be the terminating record.
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    // A real BLOCK definition + an INSERT of it.
    expect(countEntities(dxf, "BLOCK")).toBeGreaterThanOrEqual(1);
    expect(countEntities(dxf, "INSERT")).toBeGreaterThanOrEqual(1);
  });

  it("includes the device title text", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(dxf).toContain("Lightware UCX-4x2-HC60D");
  });

  it("emits a TEXT entity per connector (title + one label per expanded terminal)", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const texts = countEntities(dxf, "TEXT");
    // At least the title plus one label per terminal; UCX expands to >15 ports.
    expect(texts).toBeGreaterThan(15);
    // Each terminal label is rendered as "<label> (<type>)".
    expect(dxf).toContain("HDMI IN 1 (hdmi)");
    expect(dxf).toContain("Dante (dante)");
  });

  it("emits a terminal CIRCLE + stub LINE per connector", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(countEntities(dxf, "CIRCLE")).toBeGreaterThan(10);
    expect(countEntities(dxf, "LINE")).toBeGreaterThan(10);
  });

  it("bundle yields one BLOCK + INSERT per leaf device instance", () => {
    const dxf = runDxf(loadRaw("bundles/crestron-uc-cx100-t-wm.odio.json"));
    // 5 device models; one leaf has quantity 2 -> at least 5 blocks.
    expect(countEntities(dxf, "BLOCK")).toBeGreaterThanOrEqual(5);
    expect(countEntities(dxf, "INSERT")).toBe(countEntities(dxf, "BLOCK"));
    // Cables listed as CABLE: text annotations.
    expect(dxf).toContain("CABLE:");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });

  it("throws on invalid documents", () => {
    expect(() => DxfAdapter.export({ not: "a device" } as unknown as OdioDevice)).toThrow();
  });
});
