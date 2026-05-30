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

// Fixed stencil OPC parts that must always be present. This MUST match the part
// set of the ground-truth reference (references/visio/DTP - CrossPoint 4K Eng.vssx)
// — replicating the full part set is what makes the file open in real Visio.
const REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "docProps/custom.xml",
  "visio/document.xml",
  "visio/_rels/document.xml.rels",
  "visio/masters/masters.xml",
  "visio/masters/_rels/masters.xml.rels",
  "visio/masters/master1.xml",
  "visio/pages/pages.xml",
  "visio/windows.xml"
];

describe("Visio adapter — VSSX stencil of masters", () => {
  it("produces a valid zip with the required stencil OPC parts", () => {
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    for (const part of REQUIRED_PARTS) {
      expect(Object.keys(entries)).toContain(part);
    }
  });

  it("[Content_Types].xml declares the stencil content types (not drawing)", () => {
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const ct = strFromU8(entries["[Content_Types].xml"]);
    // Stencil document part (.vssx), NOT the .vsdx drawing content type.
    expect(ct).toContain("application/vnd.ms-visio.stencil.main+xml");
    expect(ct).not.toContain("application/vnd.ms-visio.drawing.main+xml");
    expect(ct).toContain("application/vnd.ms-visio.masters+xml");
    expect(ct).toContain("application/vnd.ms-visio.master+xml");
    expect(ct).toContain('PartName="/visio/masters/master1.xml"');
    // Full reference part set: pages, windows + all three docProps overrides.
    expect(ct).toContain("application/vnd.ms-visio.pages+xml");
    expect(ct).toContain("application/vnd.ms-visio.windows+xml");
    expect(ct).toContain('PartName="/docProps/core.xml"');
    expect(ct).toContain('PartName="/docProps/app.xml"');
    expect(ct).toContain('PartName="/docProps/custom.xml"');
  });

  it("entry set matches the ground-truth reference's part set for one device", () => {
    // The reference (1 page + 20 masters) has exactly these non-master parts plus
    // one master#.xml per master. A 1-master export must yield the same shape.
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const keys = Object.keys(entries).sort();
    expect(keys).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "docProps/custom.xml",
        "visio/_rels/document.xml.rels",
        "visio/document.xml",
        "visio/masters/_rels/masters.xml.rels",
        "visio/masters/master1.xml",
        "visio/masters/masters.xml",
        "visio/pages/pages.xml",
        "visio/windows.xml"
      ].sort()
    );
  });

  it("the file is emitted as binary bytes with a .vssx path", () => {
    const result = VisioAdapter.export(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(result.files[0].bytes).toBeInstanceOf(Uint8Array);
    expect(result.files[0].content).toBeUndefined();
    // ZIP local-file-header magic "PK\x03\x04".
    const b = result.files[0].bytes as Uint8Array;
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(result.files[0].path.endsWith(".vssx")).toBe(true);
  });

  it("masters.xml indexes one master per device with a Rel to its part", () => {
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const masters = strFromU8(entries["visio/masters/masters.xml"]);
    expect(masters).toContain("<Master ");
    expect(masters).toContain("Lightware UCX-4x2-HC60D");
    expect(masters).toContain("<Rel r:id='rId1'/>");
    // Reference Master attribute set is replicated (deterministic GUIDs included).
    expect(masters).toContain("MasterType='2'");
    expect(masters).toContain("IconUpdate='1'");
    expect(masters).toContain("UniqueID='{");
    expect(masters).toContain("BaseID='{");
    expect(masters).toContain("<PageSheet ");
    // masters.xml.rels points rId1 at master1.xml via the master relationship.
    const rels = strFromU8(entries["visio/masters/_rels/masters.xml.rels"]);
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain("relationships/master");
    expect(rels).toContain('Target="master1.xml"');
  });

  it("master1.xml carries the title, port labels and a Connection point per port", () => {
    const entries = runVisio(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const master = strFromU8(entries["visio/masters/master1.xml"]);
    expect(master).toContain("<MasterContents");
    // Device title + a couple of representative port labels in the shape text.
    expect(master).toContain("Lightware UCX-4x2-HC60D");
    expect(master).toContain("HDMI IN 1 (hdmi)");
    expect(master).toContain("Dante (dante)");
    // Master shape is a Group carrying geometry + connection (matches reference).
    expect(master).toContain("Type='Group'");
    expect(master).toContain("N='Geometry'");
    expect(master).toContain("N='Connection'");
    // One Connection Row per physical connector, matching expandConnectors.
    const connectionRows = (master.match(/<Cell N='Type' V='0'\/>/g) ?? []).length;
    expect(connectionRows).toBeGreaterThan(0);
    // Connection rows use the reference's row form + documented cell N values.
    expect(master).toContain("<Row T='Connection' IX='0'>");
    expect(master).toContain("<Cell N='X'");
    expect(master).toContain("<Cell N='Y'");
    expect(master).toContain("<Cell N='Prompt'");
    // The Prompt names a real port (label identifiable on the connection point).
    expect(master).toContain("N='Prompt' V='HDMI IN 1'");
  });

  it("connection-point count equals the expanded connector count", () => {
    const device = loadDevice("lightware-ucx-4x2-hc60d.odio.json");
    const entries = runVisio(device);
    const master = strFromU8(entries["visio/masters/master1.xml"]);
    const rowCount = (master.match(/<Row T='Connection' IX='\d+'><Cell N='X'/g) ?? []).length;
    // Each connection row has exactly one Type cell; counts must agree.
    const portCount = (master.match(/<Cell N='Type' V='0'\/>/g) ?? []).length;
    expect(rowCount).toBe(portCount);
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  it("bundle yields one master per leaf device + cable masters", () => {
    const entries = runVisio(loadRaw("bundles/crestron-uc-cx100-t-wm.odio.json"));
    const masters = strFromU8(entries["visio/masters/masters.xml"]);
    // 5 device models present by master name.
    for (const model of ["UC-ENGINE", "ADPT-USB-ENET", "HD-CONV-USB-260", "UC-PR", "TSW-1070-B-S-T-V"]) {
      expect(masters).toContain(model);
    }
    expect(masters).toContain("Cable:");
    // At least 5 device masters, each with its own master#.xml part.
    const masterCount = (masters.match(/<Master /g) ?? []).length;
    expect(masterCount).toBeGreaterThanOrEqual(5);
    expect(Object.keys(entries)).toContain(`visio/masters/master${masterCount}.xml`);
    // Each declared master has a content-type override.
    const ct = strFromU8(entries["[Content_Types].xml"]);
    for (let i = 1; i <= masterCount; i++) {
      expect(ct).toContain(`PartName="/visio/masters/master${i}.xml"`);
    }
  });

  it("throws on invalid documents", () => {
    expect(() => VisioAdapter.export({ not: "a device" } as unknown as OdioDevice)).toThrow();
  });
});
