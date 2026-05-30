import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, type OdioDevice } from "@opendeviceio/sdk";
import {
  EasySchematicAdapter,
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

// Mirror the importer's valid deviceType set so tests assert membership
// independently of the adapter's internal table.
const DEVICE_TYPES = new Set<string>([
  "camera","ptz-camera","camera-ccu","graphics","computer","media-player","mouse","keyboard",
  "video-bar","touch-screen","screen","switcher","router","converter","scaler","adapter",
  "frame-sync","multiviewer","capture-card","chromakey","da","video-wall-controller","monitor",
  "tv","projector","recorder","audio-mixer","audio-embedder","audio-interface","audio-dsp",
  "equalizer","stage-box","audio-splitter","wireless-mic-receiver","speaker","amplifier",
  "headphone-amplifier","monitor-controller","personal-monitor","ndi-encoder","ndi-decoder",
  "network-switch","streaming-encoder","av-over-ip","kvm-extender","usb-extender",
  "hdbaset-extender","wireless-video","intercom","led-processor","led-cabinet","media-server",
  "lighting-console","moving-light","led-fixture","dmx-splitter","dmx-node","control-processor",
  "tally-system","ptz-controller","sync-generator","timecode-generator","midi-device",
  "control-expansion","cable-accessory","wired-mic","iem-transmitter","change-over",
  "expansion-card","fiber-transmitter","company-switch","frame","power-distribution",
  "patch-panel","wall-plate","presentation-system","wireless-presentation","cloud-service",
  "codec","expansion-chassis","power-mixer","hdmi-splitter","network-router","nas",
  "external-storage","storage-media","lighting-processor","network-wifi","access-point",
  "intercom-transceiver","controller","button-panel","dock","studio-monitor","video-scope",
  "audio-meter","assistive-listening","battery","commentary-box","phone-hybrid",
  "interpreter-desk","table-box","antenna","antenna-distribution","conference-system","di-box",
  "display","charging-station","audio-bar","mtr-pc","touch-controller","occupancy-sensor"
]);

const HTTP_URL = /^https?:\/\//;

/** Run the adapter in the default (array) format and return the parsed array. */
function runEsArray(
  name: string
): { templates: EsDeviceTemplate[]; template: EsDeviceTemplate; warnings: string[] } {
  const device = loadDevice(name);
  const result = EasySchematicAdapter.export(device);
  const parsed = JSON.parse(result.files[0].content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("default EasySchematic output is not a bare array");
  }
  const templates = parsed as EsDeviceTemplate[];
  return { templates, template: templates[0], warnings: result.warnings };
}

// Back-compat helper used by the field-mapping tests: returns the first
// template (format is irrelevant to per-template field assertions).
function runEs(name: string): { template: EsDeviceTemplate; warnings: string[] } {
  const { template, warnings } = runEsArray(name);
  return { template, warnings };
}

const validExamples = readdirSync(examplesDir).filter((f) => f.endsWith(".odio.json"));

describe("EasySchematic adapter — invariants across every valid example", () => {
  it("finds example files", () => {
    expect(validExamples.length).toBeGreaterThan(0);
  });

  for (const name of validExamples) {
    it(`${name} produces a valid bare-array templates document`, () => {
      const { templates, template } = runEsArray(name);

      // Default output is a bare ARRAY, not a { templates } wrapper.
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
      expect((templates as unknown as { templates?: unknown }).templates).toBeUndefined();

      // Every emitted template must satisfy the in-app importer's hard rules.
      for (const t of templates) {
        expect(t.label.length).toBeGreaterThan(0);
        expect(DEVICE_TYPES.has(t.deviceType ?? "")).toBe(true);
        expect(t.manufacturer.length).toBeGreaterThan(0);
        expect(t.modelNumber.length).toBeGreaterThan(0);
        expect(t.modelNumber).not.toBe("custom");
        expect(t.referenceUrl ?? "").toMatch(HTTP_URL);
      }

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

describe("EasySchematic adapter — envelope / format option", () => {
  it("defaults to a bare ARRAY of templates (in-app importer format)", () => {
    const device = loadDevice("lightware-ucx-4x2-hc60d.odio.json");
    const parsed = JSON.parse(EasySchematicAdapter.export(device).files[0].content) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("format:'bulk' yields the { templates: [...] } wrapper", () => {
    const device = loadDevice("lightware-ucx-4x2-hc60d.odio.json");
    const result = EasySchematicAdapter.export(device, { format: "bulk" });
    const parsed = JSON.parse(result.files[0].content) as EsBulkImport;
    expect(Array.isArray(parsed)).toBe(false);
    expect(Array.isArray(parsed.templates)).toBe(true);
    expect(parsed.templates.length).toBeGreaterThan(0);
  });

  it("lightware example maps to deviceType 'switcher'", () => {
    const { template } = runEsArray("lightware-ucx-4x2-hc60d.odio.json");
    expect(template.deviceType).toBe("switcher");
  });

  it("netgear example maps to deviceType 'network-switch'", () => {
    const { template } = runEsArray("netgear-m4250-poe.odio.json");
    expect(template.deviceType).toBe("network-switch");
  });

  it("device referenceUrl falls back to the registry id when no productUrl", () => {
    const { template } = runEsArray("lightware-ucx-4x2-hc60d.odio.json");
    expect(template.referenceUrl).toBe(
      "https://opendeviceio.org/registry/lightware/ucx-4x2-hc60d"
    );
  });
});

describe("EasySchematic adapter — specific mappings", () => {
  it("netgear: poeBudgetW === 240 (8 ports x 30W PSE)", () => {
    const { template } = runEs("netgear-m4250-poe.odio.json");
    expect(template.poeBudgetW).toBe(240);
  });

  it("lightware UCX emits ONE port per connector instance (per-connector model, not per-signal)", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    // The old per-signal exporter exploded this device to 35 ports. The
    // per-connector model collapses each ODIO port to one ES port per instance
    // (respecting count) — roughly one per physical connector (~16-17 logical
    // connectors, ~22 instances once count-expanded). Assert it dropped well
    // below the old 35.
    expect(template.ports.length).toBeLessThan(30);
    // No port should carry a per-signal "usb-data" fan-out in its label.
    for (const p of template.ports) {
      expect(p.label).not.toContain("usb-data");
    }
  });

  it("lightware UCX HDMI IN (count 2) -> exactly 2 ports labeled 'HDMI IN N' typed hdmi", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    const hdmiIn = template.ports.filter((p) => p.section === "HDMI IN");
    expect(hdmiIn.length).toBe(2);
    for (const p of hdmiIn) {
      expect(p.signalType).toBe("hdmi");
      expect(p.connectorType).toBe("hdmi");
    }
    expect(new Set(hdmiIn.map((p) => p.label))).toEqual(new Set(["HDMI IN 1", "HDMI IN 2"]));
  });

  it("lightware UCX USB-C IN (count 2) -> 2 ports typed displayport (primary=video) noting the other flows", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    const usbcIn = template.ports.filter((p) => p.section === "USB-C IN");
    expect(usbcIn.length).toBe(2);
    for (const p of usbcIn) {
      expect(p.signalType).toBe("displayport");
      expect(p.connectorType).toBe("usb-c");
      // The non-primary flows must be summarized so the multi-flow detail
      // isn't lost.
      expect(p.notes ?? "").toContain("usb-data");
      expect(p.notes ?? "").toContain("power");
    }
  });

  it("lightware UCX Dante connector -> single port typed dante", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    const dante = template.ports.filter((p) => p.section === "Dante");
    expect(dante.length).toBe(1);
    expect(dante[0].signalType).toBe("dante");
  });

  it("lightware UCX: no port label contains a 'usb-data' signal suffix", () => {
    const { template } = runEs("lightware-ucx-4x2-hc60d.odio.json");
    expect(template.ports.some((p) => p.label.includes("usb-data"))).toBe(false);
  });

  it("av-processor lan-a -> ONE port (per-connector) with the primary (video) signalType", () => {
    const { template } = runEs("av-processor-crosscutting.odio.json");
    const lanPorts = template.ports.filter((p) => p.id.startsWith("lan-a"));
    // One physical RJ45 connector -> exactly one ES port, not five.
    expect(lanPorts.length).toBe(1);
    // Primary by domain priority video>audio>...: video av-over-ip -> st2110.
    expect(lanPorts[0].signalType).toBe("st2110");
    // The other concurrent flows are summarized in the notes.
    const notes = lanPorts[0].notes ?? "";
    expect(notes).toContain("dante");
    expect(notes).toContain("aes67");
  });

  it("primary-signal priority: audio+control+video -> signalType from the video mapping", () => {
    // Synthetic single-port device exercising the domain-priority selection.
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
            { domain: "video", transport: "hdmi", maxResolution: "3840x2160", maxRefreshHz: 60 }
          ]
        }
      ]
    } as unknown as OdioDevice;
    const result = EasySchematicAdapter.export(device);
    const arr = JSON.parse(result.files[0].content) as EsDeviceTemplate[];
    const ports = arr[0].ports;
    expect(ports.length).toBe(1);
    expect(ports[0].signalType).toBe("hdmi");
    // The non-primary audio + control flows are noted.
    expect(ports[0].notes ?? "").toContain("analog");
    expect(ports[0].notes ?? "").toContain("rs-232");
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

describe("EasySchematic adapter — bundle (kit) expansion", () => {
  const bundleRel = "bundles/crestron-uc-cx100-t-wm.odio.json";

  function runBundle(): { templates: EsDeviceTemplate[]; warnings: string[] } {
    const raw = readFileSync(join(examplesDir, bundleRel), "utf8");
    // Pass the raw object through the adapter, which routes by `kind`.
    const obj = JSON.parse(raw) as OdioDevice;
    const result = EasySchematicAdapter.export(obj);
    const parsed = JSON.parse(result.files[0].content) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("default bundle output is not a bare array");
    }
    return { templates: parsed as EsDeviceTemplate[], warnings: result.warnings };
  }

  it("default output is a bare ARRAY of templates", () => {
    const raw = readFileSync(join(examplesDir, bundleRel), "utf8");
    const obj = JSON.parse(raw) as OdioDevice;
    const parsed = JSON.parse(EasySchematicAdapter.export(obj).files[0].content) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("format:'bulk' still yields { templates: [...] } for the bundle", () => {
    const raw = readFileSync(join(examplesDir, bundleRel), "utf8");
    const obj = JSON.parse(raw) as OdioDevice;
    const parsed = JSON.parse(
      EasySchematicAdapter.export(obj, { format: "bulk" }).files[0].content
    ) as EsBulkImport;
    expect(Array.isArray(parsed.templates)).toBe(true);
    expect(parsed.templates.length).toBeGreaterThan(0);
  });

  it("the UC-ENGINE leaf maps to deviceType 'mtr-pc'", () => {
    const { templates } = runBundle();
    const ucEngine = templates.find((t) => t.modelNumber === "UC-ENGINE");
    expect(ucEngine?.deviceType).toBe("mtr-pc");
  });

  it("every template (devices + cables) has a valid deviceType and http referenceUrl", () => {
    const { templates } = runBundle();
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(DEVICE_TYPES.has(t.deviceType ?? "")).toBe(true);
      expect(t.referenceUrl ?? "").toMatch(HTTP_URL);
    }
  });

  it("emits one template per leaf device (all 5 models present)", () => {
    const { templates } = runBundle();
    const models = new Set(templates.filter((t) => !t.isCableAccessory).map((t) => t.modelNumber));
    for (const m of [
      "TSW-1070-B-S-T-V",
      "UC-ENGINE",
      "ADPT-USB-ENET",
      "HD-CONV-USB-260",
      "UC-PR"
    ]) {
      expect(models.has(m)).toBe(true);
    }
  });

  it("every device template has non-empty manufacturer + modelNumber and valid enums", () => {
    const { templates } = runBundle();
    const devices = templates.filter((t) => !t.isCableAccessory);
    expect(devices.length).toBeGreaterThanOrEqual(5);
    for (const t of devices) {
      expect(t.manufacturer.length).toBeGreaterThan(0);
      expect(t.modelNumber.length).toBeGreaterThan(0);
      expect(t.modelNumber).not.toBe("custom");
      for (const p of t.ports) {
        expect(SIGNAL_TYPES.has(p.signalType)).toBe(true);
        expect(CONNECTOR_TYPES.has(p.connectorType)).toBe(true);
      }
    }
  });

  it("emits cable-accessory templates with valid enum ports, deviceType + referenceUrl", () => {
    const { templates } = runBundle();
    const cables = templates.filter((t) => t.isCableAccessory === true);
    expect(cables.length).toBeGreaterThanOrEqual(4);
    for (const c of cables) {
      expect(c.deviceType).toBe("cable-accessory");
      expect(c.referenceUrl ?? "").toMatch(HTTP_URL);
      expect(c.ports.length).toBeGreaterThanOrEqual(2);
      for (const p of c.ports) {
        expect(SIGNAL_TYPES.has(p.signalType)).toBe(true);
        expect(CONNECTOR_TYPES.has(p.connectorType)).toBe(true);
        expect(p.direction).toBe("bidirectional");
      }
    }
  });

  it("DP->HDMI cable yields displayport + hdmi ends", () => {
    const { templates } = runBundle();
    const dpHd = templates.find((t) => t.modelNumber === "CBL-4K-DP-HD-6");
    expect(dpHd?.isCableAccessory).toBe(true);
    const connectors = new Set(dpHd?.ports.map((p) => p.connectorType));
    expect(connectors.has("displayport")).toBe(true);
    expect(connectors.has("hdmi")).toBe(true);
  });

  it("cable quantity recorded on the template (UC Engine LAN cable qty 2)", () => {
    const { templates } = runBundle();
    const lan = templates.find((t) => t.modelNumber === "CBL-CAT5E-7");
    expect(lan?.quantity).toBe(2);
  });

  it("kit part number UC-CX100-T-WM is discoverable on every template via searchTerms", () => {
    const { templates } = runBundle();
    for (const t of templates) {
      expect((t.searchTerms ?? []).includes("UC-CX100-T-WM")).toBe(true);
    }
  });
});
