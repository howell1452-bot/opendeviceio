import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync, strFromU8 } from "fflate";

import { parse, type OdioDevice } from "@opendeviceio/sdk";
import { VisioAdapter } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../examples");

function loadDevice(name: string): OdioDevice {
  return parse(readFileSync(join(examplesDir, name), "utf8"));
}
function loadRaw(rel: string): OdioDevice {
  return JSON.parse(readFileSync(join(examplesDir, rel), "utf8")) as OdioDevice;
}

function runVisio(device: OdioDevice): Record<string, Uint8Array> {
  const result = VisioAdapter.export(device);
  const bytes = result.files[0].bytes;
  expect(bytes).toBeInstanceOf(Uint8Array);
  return unzipSync(bytes as Uint8Array);
}

const REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "visio/document.xml",
  "visio/_rels/document.xml.rels",
  "visio/pages/pages.xml",
  "visio/pages/_rels/pages.xml.rels",
  "visio/pages/page1.xml",
  "visio/windows.xml"
];

describe("Visio adapter — VSDX package", () => {
  it("produces a valid zip with the required OPC parts", () => {
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    for (const part of REQUIRED_PARTS) {
      expect(Object.keys(entries)).toContain(part);
    }
  });

  it("the file is emitted as binary bytes (not utf8 text content)", () => {
    const result = VisioAdapter.export(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(result.files[0].bytes).toBeInstanceOf(Uint8Array);
    expect(result.files[0].content).toBeUndefined();
    // ZIP local-file-header magic "PK\x03\x04".
    const b = result.files[0].bytes as Uint8Array;
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(result.files[0].path.endsWith(".vsdx")).toBe(true);
  });

  it("page XML carries the device title and port labels", () => {
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const page = strFromU8(entries["visio/pages/page1.xml"]);
    expect(page).toContain("Lightware UCX-4x2-HC60D");
    expect(page).toContain("HDMI IN 1 (hdmi)");
    expect(page).toContain("Dante (dante)");
    // One Shape per device + Geometry/Connection sections present.
    expect(page).toContain("<Shape");
    expect(page).toContain('N="Geometry"');
    expect(page).toContain('N="Connection"');
  });

  it("bundle yields one device shape per leaf device + cable shapes", () => {
    const entries = runVisio(loadRaw("bundles/crestron-uc-cx100-t-wm.odio.json"));
    const page = strFromU8(entries["visio/pages/page1.xml"]);
    // 5 device models present by title.
    for (const model of ["UC-ENGINE", "ADPT-USB-ENET", "HD-CONV-USB-260", "UC-PR", "TSW-1070-B-S-T-V"]) {
      expect(page).toContain(model);
    }
    expect(page).toContain("Cable:");
    // At least 5 device Shapes.
    const shapeCount = (page.match(/<Shape /g) ?? []).length;
    expect(shapeCount).toBeGreaterThanOrEqual(5);
  });

  it("throws on invalid documents", () => {
    expect(() => VisioAdapter.export({ not: "a device" } as unknown as OdioDevice)).toThrow();
  });
});
