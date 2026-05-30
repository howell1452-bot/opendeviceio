// AutoCAD DXF adapter (target "dxf", .dxf).
//
// Renders each ODIO device as a schematic CAD BLOCK: a labeled rectangle with
// one labeled I/O terminal per physical connector. Terminals come from the
// shared per-connector expander (src/ports.ts) so DXF, Visio, and EasySchematic
// agree on exactly which ports a device exposes.
//
// The DXF is produced by @tarikjabiri/dxf — a maintained DXF writer that emits a
// structurally complete file (HEADER with proper handles, TABLES, BLOCKS,
// ENTITIES, OBJECTS, EOF). The previous hand-rolled group-code output failed to
// open in AutoCAD ("Processing error"); using a real writer fixes that.
//
// Version: the library writes AutoCAD R2007 (AC1021) handles/sections by
// default; we override $ACADVER to AC1027 (AutoCAD 2013) so the file declares
// the 2013 interchange format. AutoCAD 2018 (AC1032) opens AC1027 DXF natively
// and Save-As / Insert to a 2018 DWG works without conversion.
//
// Layout (matching the Visio + EasySchematic adapters' intent):
//   - one BLOCK per device: outline rectangle sized to the connector count,
//     the device title near the top, and per connector a stub LINE + a terminal
//     CIRCLE at the edge + a TEXT label "<port label> (<signalType-or-conn>)".
//   - inputs on the left edge, outputs/bidirectional on the right, distributed
//     evenly by height.
//   - each block is INSERTed into model space; bundles INSERT one block per leaf
//     device laid out in a row. Cables are listed as TEXT annotations beneath
//     the row (a full wiring diagram is out of scope for a block library).

import {
  validateDocument,
  flattenBundle,
  formatErrors,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice
} from "@opendeviceio/sdk";

import {
  DxfWriter,
  point3d,
  Units,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  type DxfBlock
} from "@tarikjabiri/dxf";

import type { Adapter, AdapterResult } from "./types.js";
import { expandConnectors, type ExpandedConnector } from "./ports.js";

// --- Layout constants (drawing units; treat as millimetres) ----------------
const TITLE_TEXT_H = 3.5;
const PORT_TEXT_H = 2.5;
const ROW_PITCH = 10; // vertical spacing between terminals
const TITLE_BAND = 12; // height reserved at the top for the title
const BOTTOM_PAD = 8;
const STUB_LEN = 6; // length of the terminal stub line outside the box
const TERMINAL_R = 1.2; // radius of the terminal circle
const BODY_WIDTH = 70; // rectangle width
const LABEL_GAP = 2; // gap between terminal circle and its text label
const BLOCK_GAP = 40; // horizontal gap between blocks in a bundle row

const LAYER_DEVICE = "DEVICE";
const LAYER_PORTS = "PORTS";

// AutoCAD 2013 DXF format header value. AutoCAD 2018 (AC1032) reads it natively.
const ACAD_VERSION = "AC1027";

/** Slugify into a DXF-safe block-name fragment (uppercased, no spaces). */
function blockName(value: string): string {
  const s = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s.length > 0 ? s : "DEVICE";
}

/** Sanitise text for a DXF TEXT value: strip control chars, collapse, cap length. */
function dxfText(value: string): string {
  // DXF TEXT does not support newlines; collapse whitespace and trim.
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
}

/** The device identity fields the DXF adapter reads. */
interface DeviceIdentity {
  manufacturer?: string;
  model?: string;
}

/** A device view: identity + ports, satisfied by both documents and leaves. */
type DeviceView = { device: DeviceIdentity; ports: OdioDevice["ports"] };

function deviceTitle(d: DeviceIdentity): string {
  const title = `${d.manufacturer ?? ""} ${d.model ?? ""}`.trim();
  return title.length > 0 ? title : "Device";
}

/** Split terminals into left (inputs) and right (outputs + bidirectional). */
function partition(terms: ExpandedConnector[]): { left: ExpandedConnector[]; right: ExpandedConnector[] } {
  const left: ExpandedConnector[] = [];
  const right: ExpandedConnector[] = [];
  for (const t of terms) {
    if (t.direction === "input") left.push(t);
    else right.push(t); // output + bidirectional on the right
  }
  return { left, right };
}

/** The signal-type-or-connector descriptor shown in a port label's parentheses. */
function portTypeLabel(t: ExpandedConnector): string {
  if (t.primaryTransport) return t.primaryTransport;
  if (t.primaryDomain) return t.primaryDomain;
  return t.connector;
}

/** Compute the block body height so every terminal row fits. */
function bodyHeight(left: ExpandedConnector[], right: ExpandedConnector[]): number {
  const rows = Math.max(left.length, right.length, 1);
  return TITLE_BAND + rows * ROW_PITCH + BOTTOM_PAD;
}

/**
 * Draw the body of one device into `block` at the block's local origin (0,0).
 * Returns the block's bounding width/height so callers can lay blocks out in a
 * row and compute drawing extents.
 */
function drawBlockBody(block: DxfBlock, view: DeviceView): { width: number; height: number } {
  const terms = expandConnectors(view);
  const { left, right } = partition(terms);
  const h = bodyHeight(left, right);

  // Outline rectangle (top-left .. bottom-right) on the DEVICE layer.
  block.addRectangle({ x: 0, y: h }, { x: BODY_WIDTH, y: 0 }, { layerName: LAYER_DEVICE });

  // Title text, centred near the top.
  block.addText(point3d(BODY_WIDTH / 2, h - TITLE_BAND + 3, 0), TITLE_TEXT_H, dxfText(deviceTitle(view.device)), {
    layerName: LAYER_DEVICE,
    horizontalAlignment: TextHorizontalAlignment.Center,
    verticalAlignment: TextVerticalAlignment.Bottom
  });

  // Terminals: rows distributed top-down inside the body (below the title band).
  const topY = h - TITLE_BAND - ROW_PITCH / 2;
  const placeColumn = (col: ExpandedConnector[], side: "left" | "right") => {
    for (let i = 0; i < col.length; i++) {
      const t = col[i];
      const y = topY - i * ROW_PITCH;
      const edgeX = side === "left" ? 0 : BODY_WIDTH;
      const tipX = side === "left" ? -STUB_LEN : BODY_WIDTH + STUB_LEN;
      // Terminal stub + circle on the PORTS layer.
      block.addLine(point3d(edgeX, y, 0), point3d(tipX, y, 0), { layerName: LAYER_PORTS });
      block.addCircle(point3d(tipX, y, 0), TERMINAL_R, { layerName: LAYER_PORTS });
      // Label: "<port label> (<signalType-or-connector>)", vertically centred on
      // the row, hanging off the terminal away from the body.
      const label = dxfText(`${t.label} (${portTypeLabel(t)})`);
      if (side === "left") {
        block.addText(point3d(tipX - TERMINAL_R - LABEL_GAP, y, 0), PORT_TEXT_H, label, {
          layerName: LAYER_PORTS,
          horizontalAlignment: TextHorizontalAlignment.Right,
          verticalAlignment: TextVerticalAlignment.Middle
        });
      } else {
        block.addText(point3d(tipX + TERMINAL_R + LABEL_GAP, y, 0), PORT_TEXT_H, label, {
          layerName: LAYER_PORTS,
          horizontalAlignment: TextHorizontalAlignment.Left,
          verticalAlignment: TextVerticalAlignment.Middle
        });
      }
    }
  };
  placeColumn(left, "left");
  placeColumn(right, "right");

  return { width: BODY_WIDTH, height: h };
}

interface BlockPlacement {
  name: string;
  view: DeviceView;
  insertX: number;
  width: number;
  height: number;
}

/** Slugify a string into a filename-safe fragment. */
function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device"
  );
}

function cableLabel(cable: CableBody, qty: number): string {
  const mfr = cable.manufacturer ?? "";
  const model = cable.model ?? cable.sku ?? cable.label ?? "cable";
  const base = `${mfr} ${model}`.trim();
  const ends = (cable.ends ?? [])
    .map((e) => (e as { connector?: string }).connector ?? "?")
    .join(" <-> ");
  const q = qty > 1 ? ` x${qty}` : "";
  return `CABLE: ${base}${q}${ends ? ` [${ends}]` : ""}`;
}

/**
 * Compute the body height of a device view without drawing it, so layout +
 * extents can be planned before blocks are created.
 */
function probeHeight(view: DeviceView): number {
  const { left, right } = partition(expandConnectors(view));
  return bodyHeight(left, right);
}

/**
 * Build the whole DXF document from a planned list of block placements and a
 * list of cable annotation labels.
 */
function buildDxf(blocks: BlockPlacement[], cables: { label: string }[]): string {
  const dxf = new DxfWriter();
  // Millimetre units; declare the AutoCAD 2013 format so AutoCAD 2018 opens it
  // natively. setUnits also writes $INSUNITS so INSERTs scale correctly.
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable("$ACADVER", { 1: ACAD_VERSION });

  // Layers: DEVICE (white/7 — outline + title), PORTS (blue/5 — terminals).
  dxf.addLayer(LAYER_DEVICE, 7, "Continuous");
  dxf.addLayer(LAYER_PORTS, 5, "Continuous");

  // One BLOCK definition per device.
  for (const b of blocks) {
    const block = dxf.addBlock(b.name);
    drawBlockBody(block, b.view);
  }

  // INSERT each block into model space at its row position.
  for (const b of blocks) {
    dxf.addInsert(b.name, point3d(b.insertX, 0, 0), { layerName: LAYER_DEVICE });
  }

  // Cables: list as TEXT annotations beneath the row, in model space.
  let cy = -16;
  for (const c of cables) {
    dxf.addText(point3d(0, cy, 0), PORT_TEXT_H, dxfText(c.label), {
      layerName: LAYER_DEVICE,
      horizontalAlignment: TextHorizontalAlignment.Left,
      verticalAlignment: TextVerticalAlignment.Top
    });
    cy -= ROW_PITCH * 0.8;
  }

  // Drawing extents so AutoCAD opens zoomed to the content.
  const extMaxX = blocks.reduce((m, b) => Math.max(m, b.insertX + b.width), BODY_WIDTH);
  const extMaxY = blocks.reduce((m, b) => Math.max(m, b.height), TITLE_BAND);
  const extMinY = Math.min(-20, cy);
  dxf.setVariable("$EXTMIN", { 10: -STUB_LEN - 60, 20: extMinY, 30: 0 });
  dxf.setVariable("$EXTMAX", { 10: extMaxX + 60, 20: extMaxY + 10, 30: 0 });

  return dxf.stringify();
}

/**
 * The AutoCAD DXF adapter. Validates the input via the SDK, then renders one
 * BLOCK per device (laid out in a row for bundles) with labeled I/O terminals.
 */
export const DxfAdapter: Adapter = {
  id: "dxf",
  label: "AutoCAD DXF (schematic block)",
  fileExtension: "dxf",

  export(device: OdioDevice): AdapterResult {
    const routed = validateDocument(device);
    if (!routed.valid) {
      throw new Error(
        `DXF adapter: input is not a valid OpenDeviceIO ${routed.kind} document:\n${formatErrors(
          routed.errors
        )}`
      );
    }

    const warnings: string[] = [];
    const blocks: BlockPlacement[] = [];
    const cables: { label: string }[] = [];
    let fileBase: string;

    const addDevice = (view: DeviceView, nameSeed: string) => {
      const name = blockName(nameSeed);
      // Disambiguate duplicate block names within one drawing.
      let unique = name;
      let n = 1;
      while (blocks.some((b) => b.name === unique)) {
        unique = `${name}_${++n}`;
      }
      const height = probeHeight(view);
      const insertX = blocks.reduce((m, b) => Math.max(m, b.insertX + b.width + BLOCK_GAP), 0);
      blocks.push({ name: unique, view, insertX, width: BODY_WIDTH, height });
    };

    if (routed.kind === "bundle") {
      const bundle = device as unknown as Bundle;
      const flat = flattenBundle(bundle);
      for (const entry of flat.devices) {
        const view = entry.device as FlattenedDevice;
        if (!view.device?.manufacturer || !view.device?.model) {
          warnings.push(
            `Bundle leaf "${entry.path.join(" / ")}": device missing manufacturer/model; skipped.`
          );
          continue;
        }
        const qty = entry.quantity >= 1 ? entry.quantity : 1;
        for (let unit = 1; unit <= qty; unit++) {
          const seed = `${view.device.manufacturer}-${view.device.model}${qty > 1 ? `-${unit}` : ""}`;
          addDevice({ device: view.device, ports: view.ports }, seed);
        }
      }
      for (const entry of flat.cables) {
        cables.push({ label: cableLabel(entry.cable as CableBody, entry.quantity) });
      }
      for (const ref of flat.unresolvedRefs) {
        warnings.push(`Unresolved ${ref.type} reference at "${ref.path.join(" / ")}"; not rendered.`);
      }
      if (blocks.length === 0) {
        throw new Error("DXF adapter: bundle expanded to zero devices.");
      }
      fileBase = fileSlug(`${bundle.bundle?.manufacturer ?? ""}-${bundle.bundle?.model ?? "bundle"}`);
    } else if (routed.kind === "cable") {
      // A standalone cable has no device block; render it as a labeled empty box
      // so the file is still a valid, openable drawing.
      const cable = (device as unknown as { cable: CableBody }).cable;
      cables.push({ label: cableLabel(cable, 1) });
      addDevice(
        { device: { manufacturer: cable.manufacturer, model: cable.model ?? cable.label }, ports: [] as never },
        `${cable.manufacturer ?? ""}-${cable.model ?? cable.label ?? "cable"}`
      );
      fileBase = fileSlug(`${cable.manufacturer ?? ""}-${cable.model ?? cable.label ?? "cable"}`);
    } else {
      const view = device as DeviceView;
      if (!view.device?.manufacturer || !view.device?.model) {
        throw new Error("DXF adapter: device must have a non-empty manufacturer and model.");
      }
      addDevice(view, `${view.device.manufacturer}-${view.device.model}`);
      fileBase = fileSlug(`${view.device.manufacturer}-${view.device.model}`);
    }

    const content = buildDxf(blocks, cables);
    return {
      files: [{ path: `${fileBase}.dxf`, content }],
      warnings
    };
  }
};
