import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, type OdioDevice } from "@opendeviceio/sdk";
import { expandConnectors } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../examples");

function loadDevice(name: string): OdioDevice {
  return parse(readFileSync(join(examplesDir, name), "utf8"));
}

describe("expandConnectors — shared per-connector model", () => {
  it("collapses a multi-signal connector to one terminal typed by the primary (by priority)", () => {
    // Synthetic device: one connector carrying audio + control + video. The
    // primary must be video (highest priority), the rest summarized in carries.
    const device = {
      $schema: "https://opendeviceio.org/schema/v0.1/device.schema.json",
      odioVersion: "0.1.0",
      id: "test/priority",
      device: { manufacturer: "Test", model: "PRIORITY-1", category: "av/switcher/matrix" },
      ports: [
        {
          id: "multi",
          label: "MULTI",
          direction: "bidirectional",
          connector: "hdmi-type-a",
          signals: [
            { domain: "audio", transport: "analog" },
            { domain: "control", transport: "rs-232" },
            { domain: "video", transport: "hdmi" }
          ]
        }
      ]
    } as unknown as OdioDevice;

    const terms = expandConnectors(device);
    expect(terms.length).toBe(1);
    expect(terms[0].primaryDomain).toBe("video");
    expect(terms[0].primaryTransport).toBe("hdmi");
    // Non-primary flows summarized (order-preserving, distinct).
    expect(terms[0].carries).toContain("analog");
    expect(terms[0].carries).toContain("rs-232");
  });

  it("count-expands a connector into one terminal per physical instance", () => {
    const terms = expandConnectors(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const hdmiIn = terms.filter((t) => t.section === "HDMI IN");
    expect(hdmiIn.length).toBe(2);
    expect(new Set(hdmiIn.map((t) => t.label))).toEqual(new Set(["HDMI IN 1", "HDMI IN 2"]));
    for (const t of hdmiIn) expect(t.primaryDomain).toBe("video");
    // ids are unique across the device.
    const ids = terms.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("folds embedded HDMI audio into the note rather than a separate terminal", () => {
    const terms = expandConnectors(loadDevice("lightware-ucx-4x2-hc60d.odio.json"));
    const hdmiIn = terms.filter((t) => t.section === "HDMI IN");
    for (const t of hdmiIn) {
      expect(t.primaryDomain).toBe("video");
      expect((t.notes ?? "").toLowerCase()).toContain("embedded audio");
    }
  });
});
