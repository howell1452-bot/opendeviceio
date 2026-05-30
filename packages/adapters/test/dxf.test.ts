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

/** Count entity records of a given type ("  0\r\nTYPE" → exact-line match). */
function countEntities(dxf: string, type: string): number {
  const lines = dxf.split(/\r?\n/);
  let n = 0;
  for (const l of lines) if (l === type) n++;
  return n;
}

// @tarikjabiri/dxf always emits two standard blocks (*Model_Space and
// *Paper_Space) in addition to any device blocks we define, so the number of
// device blocks is the total BLOCK record count minus 2.
function deviceBlockCount(dxf: string): number {
  return countEntities(dxf, "BLOCK") - 2;
}

describe("DXF adapter — structure", () => {
  it("emits the required DXF section markers, the 2013 version, and EOF", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("HEADER");
    expect(dxf).toContain("TABLES");
    expect(dxf).toContain("BLOCKS");
    expect(dxf).toContain("ENTITIES");
    expect(dxf).toContain("ENDSEC");
    // AutoCAD 2013 DXF format (AC1027) — opened natively by AutoCAD 2018.
    expect(dxf).toContain("$ACADVER");
    expect(dxf).toContain("AC1027");
    // EOF must be the terminating record.
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    // A real device BLOCK definition + an INSERT of it.
    expect(deviceBlockCount(dxf)).toBeGreaterThanOrEqual(1);
    expect(countEntities(dxf, "INSERT")).toBeGreaterThanOrEqual(1);
  });

  it("includes the device title text", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(dxf).toContain("Lightware UCX-4x2-HC60D");
  });

  it("emits a TEXT entity per connector (title + one label per expanded terminal)", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const texts = countEntities(dxf, "TEXT");
    // Title (+ optional power subtitle) plus a two-line label (name + connector
    // type) per terminal; UCX expands to >15 ports, so well over 15 TEXT entities.
    expect(texts).toBeGreaterThan(15);
    // Each terminal renders a name line and a connector-type line (AVCAD style):
    // the port name "HDMI IN 1" over the connector "HDMI".
    expect(dxf).toContain("HDMI IN 1");
    expect(dxf).toContain("Dante");
  });

  it("emits a terminal CIRCLE + stub LINE per connector", () => {
    const dxf = runDxf(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(countEntities(dxf, "CIRCLE")).toBeGreaterThan(10);
    expect(countEntities(dxf, "LINE")).toBeGreaterThan(10);
  });

  it("bundle yields one device BLOCK + INSERT per leaf device instance", () => {
    const dxf = runDxf(loadRaw("bundles/crestron-uc-cx100-t-wm.odio.json"));
    // 5 device models; one leaf has quantity 2 -> at least 5 device blocks.
    expect(deviceBlockCount(dxf)).toBeGreaterThanOrEqual(5);
    // One INSERT per device block we defined.
    expect(countEntities(dxf, "INSERT")).toBe(deviceBlockCount(dxf));
    // Cables listed as CABLE: text annotations.
    expect(dxf).toContain("CABLE:");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });

  it("throws on invalid documents", () => {
    expect(() => DxfAdapter.export({ not: "a device" } as unknown as OdioDevice)).toThrow();
  });
});
