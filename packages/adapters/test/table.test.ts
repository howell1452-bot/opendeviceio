import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, type OdioDevice } from "@opendeviceio/sdk";
import { buildIoTable, renderTableSvg } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../examples");

function loadDevice(name: string): OdioDevice {
  return parse(readFileSync(join(examplesDir, name), "utf8"));
}
function loadRaw(rel: string): OdioDevice {
  return JSON.parse(readFileSync(join(examplesDir, rel), "utf8")) as OdioDevice;
}

describe("I/O-table projection + SVG renderer", () => {
  it("builds a single-section table for a device with grouped rows", () => {
    const table = buildIoTable(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    expect(table.title).toContain("Lightware");
    expect(table.sections).toHaveLength(1);
    const rows = table.sections[0].rows;
    expect(rows.length).toBeGreaterThan(15);
    // Groups present and ordered (Input before Output before Bidirectional).
    const groups = rows.map((r) => r.group);
    expect(groups).toContain("Input");
    expect(groups).toContain("Output");
    expect(groups).toContain("Bidirectional");
    expect(groups.indexOf("Input")).toBeLessThan(groups.indexOf("Output"));
    // A representative row carries connector + link + signals.
    const hdmiIn = rows.find((r) => r.label.startsWith("HDMI IN 1"));
    expect(hdmiIn?.connector).toBe("HDMI");
    expect(hdmiIn?.dir).toBe("In");
    expect(hdmiIn?.signals).toContain("HDMI");
  });

  it("renders a self-contained SVG with title, headers and group bands", () => {
    const svg = renderTableSvg(buildIoTable(loadDevice("lightware-ucx-4x2-hc60d.odio.json")));
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain("<svg ");
    expect(svg).toContain("Lightware UCX-4x2-HC60D");
    for (const band of ["INPUTS", "OUTPUTS", "BIDIRECTIONAL"]) {
      expect(svg).toContain(`>${band}<`);
    }
    // No malformed plural.
    expect(svg).not.toContain("BIDIRECTIONALS");
    // Column headers.
    for (const h of ["Label", "Dir", "Connector", "Link", "Signals"]) {
      expect(svg).toContain(`>${h}<`);
    }
    expect(svg).toMatch(/<svg [^>]*width="\d+"[^>]*height="\d+"/);
  });

  it("builds a multi-section table + components list for a bundle", () => {
    const table = buildIoTable(loadRaw("bundles/crestron-uc-cx100-t-wm.odio.json"));
    expect(table.sections.length).toBeGreaterThanOrEqual(5);
    expect(table.sections.every((s) => typeof s.heading === "string")).toBe(true);
    expect(table.components && table.components.length).toBeGreaterThanOrEqual(5);
    const svg = renderTableSvg(table);
    expect(svg).toContain("COMPONENTS");
  });
});
