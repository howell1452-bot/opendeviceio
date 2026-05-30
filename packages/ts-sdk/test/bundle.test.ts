import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateBundle,
  validateCable,
  validateDocument,
  parseBundle,
  parseDocument,
  OdioValidationError,
  flattenBundle,
  bundleDeviceCount,
  bundleBillOfMaterials,
  validateChassis,
  type Bundle,
  type ResolvedDocument
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "examples");
const bundlesDir = path.join(examplesDir, "bundles");

function load(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function bundleFiles(): string[] {
  return readdirSync(bundlesDir)
    .filter((f) => f.endsWith(".odio.json"))
    .map((f) => path.join(bundlesDir, f));
}

const crestronFile = path.join(bundlesDir, "crestron-uc-cx100-t-wm.odio.json");
const crestron = load(crestronFile) as Bundle;

describe("validateBundle on the example corpus", () => {
  const files = bundleFiles();

  it("finds the bundle examples", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it.each(files)("%s validates as a valid bundle", (file) => {
    const result = validateBundle(load(file));
    if (!result.valid) {
      throw new Error(
        `${file} should be a valid bundle but had errors:\n` +
          result.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")
      );
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("validateDocument routing", () => {
  it("routes a bundle document to kind 'bundle'", () => {
    const result = validateDocument(crestron);
    expect(result.kind).toBe("bundle");
    expect(result.valid).toBe(true);
  });

  it("routes a device example (no kind) to kind 'device'", () => {
    const device = load(path.join(examplesDir, "extron-dtp2-t-211.odio.json"));
    const result = validateDocument(device);
    expect(result.kind).toBe("device");
    expect(result.valid).toBe(true);
  });

  it("routes a standalone cable document to kind 'cable'", () => {
    const cableDoc = {
      $schema: "https://opendeviceio.org/schema/v0.1/cable.schema.json",
      odioVersion: "0.1.0",
      kind: "cable",
      id: "crestron/cbl-hd-6",
      cable: {
        model: "CBL-HD-6",
        ends: [
          { connector: "hdmi-type-a", gender: "male" },
          { connector: "hdmi-type-a", gender: "male" }
        ]
      }
    };
    expect(validateCable(cableDoc).valid).toBe(true);
    const result = validateDocument(cableDoc);
    expect(result.kind).toBe("cable");
    expect(result.valid).toBe(true);
  });
});

describe("parseBundle / parseDocument", () => {
  it("parseBundle returns the typed bundle", () => {
    const b = parseBundle(readFileSync(crestronFile, "utf8"));
    expect(b.kind).toBe("bundle");
    expect(b.bundle.model).toBe("UC-CX100-T-WM");
  });

  it("parseDocument round-trips the bundle", () => {
    const doc = parseDocument(readFileSync(crestronFile, "utf8")) as Bundle;
    expect(doc.kind).toBe("bundle");
  });

  it("parseBundle throws OdioValidationError on an invalid bundle", () => {
    expect(() => parseBundle({ kind: "bundle" })).toThrow(OdioValidationError);
  });

  it("parseBundle throws SyntaxError on malformed JSON", () => {
    expect(() => parseBundle("{ not json")).toThrow(SyntaxError);
  });
});

describe("flattenBundle on the Crestron kit", () => {
  const flat = flattenBundle(crestron);

  it("yields exactly 5 leaf devices", () => {
    expect(flat.devices).toHaveLength(5);
    expect(flat.devices.map((d) => d.device.device?.model)).toEqual([
      "TSW-1070-B-S-T-V",
      "UC-ENGINE",
      "ADPT-USB-ENET",
      "HD-CONV-USB-260",
      "UC-PR"
    ]);
  });

  it("reaches the 3 UC-bracket devices via the nested assembly (path includes UC-BRKT)", () => {
    const bracketModels = ["UC-ENGINE", "ADPT-USB-ENET", "HD-CONV-USB-260"];
    for (const model of bracketModels) {
      const entry = flat.devices.find((d) => d.device.device?.model === model);
      expect(entry, model).toBeDefined();
      expect(entry!.path).toContain("UC Bracket Assembly");
      expect(entry!.designators).toContain("UC Bracket Assembly");
    }
    // The top-level touch screen is NOT under the bracket assembly.
    const tsw = flat.devices.find(
      (d) => d.device.device?.model === "TSW-1070-B-S-T-V"
    );
    expect(tsw!.path).not.toContain("UC Bracket Assembly");
  });

  it("carries device ports through to the leaf", () => {
    const ucpr = flat.devices.find((d) => d.device.device?.model === "UC-PR");
    expect(ucpr!.device.ports.length).toBeGreaterThan(0);
  });

  it("total cable quantity across the kit is 6", () => {
    const total = flat.cables.reduce((n, c) => n + c.quantity, 0);
    expect(total).toBe(6);
    // 1 DP-HD + 1 HDMI + 2 CAT5E + 2 CAT6a
    const byModel = Object.fromEntries(
      flat.cables.map((c) => [c.cable?.model, c.quantity])
    );
    expect(byModel["CBL-4K-DP-HD-6"]).toBe(1);
    expect(byModel["CBL-HD-6"]).toBe(1);
    expect(byModel["CBL-CAT5E-7"]).toBe(2);
    expect(byModel["DM-CBL-ULTRA-PC-20"]).toBe(2);
  });

  it("collects the mounting-hardware accessory", () => {
    expect(flat.accessories).toHaveLength(1);
    expect(flat.accessories[0].accessory.name).toBe("Mounting hardware");
    expect(flat.accessories[0].quantity).toBe(1);
  });

  it("records no unresolved refs (the kit is fully inline)", () => {
    expect(flat.unresolvedRefs).toHaveLength(0);
  });
});

describe("flattenBundle quantity multiplication and refs", () => {
  const syntheticRef: Bundle = {
    $schema: "https://opendeviceio.org/schema/v0.1/bundle.schema.json",
    odioVersion: "0.1.0",
    kind: "bundle",
    id: "acme/kit",
    bundle: { manufacturer: "Acme", model: "KIT-1" },
    components: [
      {
        type: "device",
        designator: "Referenced widget",
        ref: { id: "acme/widget" }
      }
    ]
  } as unknown as Bundle;

  it("a ref-only component with no resolver lands in unresolvedRefs", () => {
    const flat = flattenBundle(syntheticRef);
    expect(flat.devices).toHaveLength(0);
    expect(flat.unresolvedRefs).toHaveLength(1);
    expect(flat.unresolvedRefs[0].type).toBe("device");
    expect(flat.unresolvedRefs[0].ref.id).toBe("acme/widget");
  });

  it("a resolver expands the ref into a leaf device", () => {
    const resolve = (ref: { id?: string }): ResolvedDocument | undefined =>
      ref.id === "acme/widget"
        ? ({
            device: { manufacturer: "Acme", model: "WIDGET-1" },
            ports: [
              {
                id: "p1",
                direction: "input",
                connector: "rj45",
                signals: [{ domain: "network", transport: "ethernet" }]
              }
            ]
          } as unknown as ResolvedDocument)
        : undefined;
    const flat = flattenBundle(syntheticRef, { resolve });
    expect(flat.unresolvedRefs).toHaveLength(0);
    expect(flat.devices).toHaveLength(1);
    expect(flat.devices[0].device.device?.model).toBe("WIDGET-1");
  });

  it("multiplies quantities down the tree (2 inside a x3 sub-bundle => 6)", () => {
    const nested: Bundle = {
      $schema: "https://opendeviceio.org/schema/v0.1/bundle.schema.json",
      odioVersion: "0.1.0",
      kind: "bundle",
      id: "acme/outer",
      bundle: { manufacturer: "Acme", model: "OUTER" },
      components: [
        {
          type: "bundle",
          quantity: 3,
          designator: "Inner",
          bundle: { manufacturer: "Acme", model: "INNER" },
          components: [
            {
              type: "device",
              quantity: 2,
              device: { manufacturer: "Acme", model: "D" },
              ports: [
                {
                  id: "p",
                  direction: "input",
                  connector: "rj45",
                  signals: [{ domain: "network", transport: "ethernet" }]
                }
              ]
            }
          ]
        }
      ]
    } as unknown as Bundle;
    const flat = flattenBundle(nested);
    expect(flat.devices).toHaveLength(1);
    expect(flat.devices[0].quantity).toBe(6);
    expect(bundleDeviceCount(nested)).toBe(6);
  });
});

describe("bundleDeviceCount and bundleBillOfMaterials", () => {
  it("bundleDeviceCount sums effective device quantities (5 for the Crestron kit)", () => {
    expect(bundleDeviceCount(crestron)).toBe(5);
  });

  it("bundleBillOfMaterials lists devices, cables and accessories", () => {
    const bom = bundleBillOfMaterials(crestron);
    // 5 devices + 4 cable lines + 1 accessory = 10 lines.
    expect(bom).toHaveLength(10);
    const totalQty = bom.reduce((n, l) => n + l.quantity, 0);
    // 5 devices + 6 cables + 1 accessory = 12 units.
    expect(totalQty).toBe(12);
    expect(bom.filter((l) => l.kind === "device")).toHaveLength(5);
    expect(bom.filter((l) => l.kind === "cable")).toHaveLength(4);
    expect(bom.filter((l) => l.kind === "accessory")).toHaveLength(1);
    expect(bom).toContainEqual({
      kind: "accessory",
      model: "Mounting hardware",
      quantity: 1
    });
  });
});

describe("modular chassis (slots / cards)", () => {
  const frameFile = path.join(bundlesDir, "example-modular-frame-configured.odio.json");
  const frame = load(frameFile) as Bundle;

  it("is a valid bundle and flattens frame + cards with slot assignments", () => {
    expect(validateDocument(frame).valid).toBe(true);
    const flat = flattenBundle(frame);
    expect(flat.devices).toHaveLength(3);
    const byModel = Object.fromEntries(flat.devices.map((d) => [d.device.device.model, d]));
    // Frame carries slot topology; cards carry their slot assignment + card block.
    expect(byModel["FRAME-4"].device.slots?.length).toBe(4);
    expect(byModel["FRAME-4"].slot).toBeUndefined();
    expect(byModel["CARD-HDMI-IN-4"].slot).toBe("in-1");
    expect(byModel["CARD-HDMI-IN-4"].device.card?.slotType).toBe("frame4-input");
    expect(byModel["CARD-HDBT-OUT-4"].slot).toBe("out-1");
  });

  it("validateChassis passes a well-formed configuration", () => {
    expect(validateChassis(frame)).toEqual([]);
  });

  it("validateChassis flags missing slot, wrong slotType, and double-occupancy", () => {
    const bad = JSON.parse(JSON.stringify(frame)) as Bundle;
    const comps = bad.components as Array<Record<string, unknown>>;
    // card 1 -> nonexistent slot; card 2 -> wrong type into out-1; then a dupe.
    comps[1].slot = "nope";
    (comps[2].card as Record<string, unknown>).slotType = "frame4-input";
    comps[2].slot = "out-1";
    comps.push({ ...(comps[2] as object), designator: "Second out card", slot: "out-1" });
    const msgs = validateChassis(bad).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/no frame in this bundle defines/);
    expect(msgs).toMatch(/does not fit slot 'out-1'/);
    expect(msgs).toMatch(/more than one card/);
  });

  it("validateChassis returns nothing for a non-chassis bundle", () => {
    expect(validateChassis(crestron)).toEqual([]);
  });
});
