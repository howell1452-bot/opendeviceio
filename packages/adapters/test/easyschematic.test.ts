import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, type OdioDevice } from "@opendeviceio/sdk";
import {
  EasySchematicAdapter,
  DxfAdapter,
  VisioAdapter,
  AvcadAdapter,
  NotImplementedError,
  type EsBulkImport,
  type EsDeviceTemplate
} from "../src/index.js";

// Mirror the enum literal sets so tests assert membership independently of the
// adapter's internal tables.
const SIGNAL_TYPES = new Set<string>([
  "sdi","hdmi","ndi","dante","avb","analog-audio","speaker-level","bluetooth","aes","dmx","madi",
  "usb","ethernet","fiber","displayport","hdbaset","srt","genlock","gpio","contact-closure","rs422",
  "serial","thunderbolt","composite","s-video","vga","dvi","power","power-l1","power-l2","power-l3",
  "power-neutral","power-ground","midi","tally","spdif","adat","ultranet","aes50","stageconnect",
  "wordclock","aes67","ydif","rf","st2110","artnet","sacn","ir","timecode","gigaace","dx5","slink",
  "soundgrid","fibreace","dsnake","dxlink","gps","dars","rtmp","rtsp","mpeg-ts","component-video",
  "digilink","ebus","control-voltage","extron-exp","pots","blu-link","cresnet","sensor","custom"
]);

const CONNECTOR_TYPES = new Set<string>([
  "bnc","hdmi","displayport","vga","xlr-3","xlr-4","xlr-5","trs-quarter","trs-eighth","combo-xlr-trs",
  "rj45","ethercon","sfp","lc","sc","usb-a","usb-b","usb-c","db7w2","db9","db15","db25","din-5",
  "phoenix","terminal-block","powercon","edison","iec","iec-c5","iec-c7","iec-c15","iec-c20","speakon",
  "socapex","multipin","rca","toslink","barrel","banana","binding-post","binding-post-banana","dvi",
  "mini-xlr","opticalcon","l5-20","l6-20","l6-30","l21-30","cam-lok","powercon-true1","qsfp","qsfp28",
  "mpo","digilink","pcie-6pin","mini-din-4","mini-din-7","mini-din-8","mini-hdmi","mini-displayport",
  "rj11","rj12","usb-mini","usb-micro","trs-2.5mm","reverse-tnc","sma","db37","d-tap","v-mount",
  "f-connector","lemo-2pin","lemo-4pin","lemo-5pin","wireless","solder-cup","punch-down-110",
  "punch-down-66","krone-idc","d-hole-insert","none","other"
]);

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../examples");

function loadDevice(name: string): OdioDevice {
  const raw = readFileSync(join(examplesDir, name), "utf8");
  return parse(raw);
}

function runEs(name: string): { doc: EsBulkImport; template: EsDeviceTemplate; warnings: string[] } {
  const device = loadDevice(name);
  const result = EasySchematicAdapter.export(device);
  const doc = JSON.parse(result.files[0].content) as EsBulkImport;
  return { doc, template: doc.templates[0], warnings: result.warnings };
}

const validExamples = readdirSync(examplesDir).filter((f) => f.endsWith(".odio.json"));

describe("EasySchematic adapter — invariants across every valid example", () => {
  it("finds example files", () => {
    expect(validExamples.length).toBeGreaterThan(0);
  });

  for (const name of validExamples) {
    it(`${name} produces a valid templates document`, () => {
      const { doc, template } = runEs(name);

      expect(Array.isArray(doc.templates)).toBe(true);
      expect(doc.templates.length).toBeGreaterThan(0);

      expect(template.manufacturer.length).toBeGreaterThan(0);
      expect(template.modelNumber.length).toBeGreaterThan(0);
      expect(template.modelNumber).not.toBe("custom");

      const ids = new Set<string>();
      for (const port of template.ports) {
        expect(SIGNAL_TYPES.has(port.signalType)).toBe(true);
        expect(CONNECTOR_TYPES.has(port.connectorType)).toBe(true);
        expect(ids.has(port.id)).toBe(false);
        ids.add(port.id);
      }
    });
  }
});

describe("EasySchematic adapter — specific mappings", () => {
  it("netgear: poeBudgetW === 240 (8 ports x 30W PSE)", () => {
    const { template } = runEs("netgear-m4250-poe.odio.json");
    expect(template.poeBudgetW).toBe(240);
  });

  it("lightware UCX HDMI IN (count 2) -> at least 2 ports with signalType 'hdmi'", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    const hdmiPorts = template.ports.filter((p) => p.signalType === "hdmi");
    expect(hdmiPorts.length).toBeGreaterThanOrEqual(2);
  });

  it("av-processor lan-a -> emits dante, aes67, and ethernet/control flows (>=3 ports)", () => {
    const { template } = runEs("av-processor-crosscutting.odio.json");
    const lanPorts = template.ports.filter((p) => p.id.startsWith("lan-a"));
    expect(lanPorts.length).toBeGreaterThanOrEqual(3);
    const types = new Set(lanPorts.map((p) => p.signalType));
    expect(types.has("dante")).toBe(true);
    expect(types.has("aes67")).toBe(true);
    expect(types.has("ethernet")).toBe(true);
  });

  it("embedded HDMI lpcm audio does NOT create a separate audio/custom port", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    // The HDMI IN port has video(hdmi) + audio(lpcm). The lpcm flow must be
    // embedded (no separate port), so among ports whose section is "HDMI IN"
    // there must be only hdmi-typed ports, none typed 'custom'.
    const hdmiInPorts = template.ports.filter((p) => p.section === "HDMI IN");
    expect(hdmiInPorts.length).toBeGreaterThan(0);
    for (const p of hdmiInPorts) {
      expect(p.signalType).toBe("hdmi");
    }
    // And the embedded audio should be noted on the video port.
    expect(hdmiInPorts.some((p) => (p.notes ?? "").toLowerCase().includes("embedded audio"))).toBe(
      true
    );
  });

  it("weightKg conversion (grams/1000)", () => {
    const { template } = runEs("netgear-m4250-poe.odio.json");
    // weightGrams 2200 -> 2.2 kg
    expect(template.weightKg).toBeCloseTo(2.2, 6);
  });

  it("thermalBtuh passthrough when power.heatBtuPerHour present", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    // heatBtuPerHour 471 in the source -> passthrough.
    expect(template.thermalBtuh).toBe(471);
  });

  it("thermalBtuh derived (W * 3.412) when heatBtuPerHour absent", () => {
    const { template } = runEs("netgear-m4250-poe.odio.json");
    // No heatBtuPerHour; max 280W -> 280 * 3.412.
    expect(template.thermalBtuh).toBeCloseTo(280 * 3.412, 6);
  });

  it("lightware: video capabilities carried over (maxResolution / maxFrameRate)", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    const hdmiIn = template.ports.find((p) => p.section === "HDMI IN" && p.signalType === "hdmi");
    expect(hdmiIn?.capabilities?.maxResolution).toBe("5120x2160");
    expect(hdmiIn?.capabilities?.maxFrameRate).toBe(60);
  });

  it("netgear: connector rj45 -> rj45, sfp+ -> sfp; linkSpeed on network ports", () => {
    const { template } = runEs("netgear-m4250-poe.odio.json");
    const poePort = template.ports.find((p) => p.id.startsWith("ge-poe"));
    expect(poePort?.connectorType).toBe("rj45");
    expect(poePort?.linkSpeed).toBe("1g");
    const sfpPort = template.ports.find((p) => p.id.startsWith("sfp-uplink"));
    expect(sfpPort?.connectorType).toBe("sfp");
  });

  it("av-processor lan-a is a PoE PD link -> poeDrawW recorded on its ports", () => {
    const { template } = runEs("av-processor-crosscutting.odio.json");
    const lanPort = template.ports.find((p) => p.id.startsWith("lan-a"));
    expect(lanPort?.poeDrawW).toBe(25);
    // device-level poeDrawW
    expect(template.poeDrawW).toBe(25);
  });

  it("gpio channelCount carried (channels=8)", () => {
    const { template } = runEs("generic-dsp-8gpio.odio.json");
    const gpio = template.ports.find((p) => p.signalType === "gpio");
    expect(gpio?.channelCount).toBe(8);
  });
});

describe("Stub adapters", () => {
  it("DxfAdapter.export throws NotImplementedError", () => {
    const device = loadDevice("netgear-m4250-poe.odio.json");
    expect(() => DxfAdapter.export(device)).toThrow(NotImplementedError);
  });

  it("VisioAdapter.export throws NotImplementedError", () => {
    const device = loadDevice("netgear-m4250-poe.odio.json");
    expect(() => VisioAdapter.export(device)).toThrow(NotImplementedError);
  });

  it("AvcadAdapter.export throws NotImplementedError", () => {
    const device = loadDevice("netgear-m4250-poe.odio.json");
    expect(() => AvcadAdapter.export(device)).toThrow(NotImplementedError);
  });
});

describe("EasySchematic adapter — invalid input", () => {
  it("throws on invalid documents", () => {
    expect(() => EasySchematicAdapter.export({ not: "a device" } as unknown as OdioDevice)).toThrow();
  });
});
