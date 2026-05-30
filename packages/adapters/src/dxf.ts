// AutoCAD DXF adapter (target "dxf", .dxf).
//
// Renders each ODIO device as a schematic CAD BLOCK: a labeled rectangle with
// one labeled I/O terminal per physical connector. Terminals come from the
// shared per-connector expander (src/ports.ts) so DXF, Visio, and EasySchematic
// agree on exactly which ports a device exposes.
//
// Output is hand-rolled ASCII DXF (no dependency) targeting the R12/2000
// interchange subset that AutoCAD and most CAD/EDA tools accept:
//   - a minimal HEADER (ACAD version + extents)
//   - a TABLES section with two LAYERS (DEVICE outline/text, PORTS terminals)
//   - a BLOCKS section: one BLOCK per device (rectangle + title + per-port stub,
//     terminal CIRCLE, and TEXT label)
//   - an ENTITIES section that INSERTs each block (laid out in a row for bundles)
//
// Each device is emitted as a reusable BLOCK and dropped into model space with
// an INSERT, which is what "CAD blocks" asks for. Bundles emit one BLOCK+INSERT
// per leaf device (via flattenBundle); cables are listed as TEXT annotations
// beneath the row (a wiring diagram is out of scope for a block library).

import {
  validateDocument,
  flattenBundle,
  formatErrors,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice
} from "@opendeviceio/sdk";

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

/** Slugify into a DXF-safe block-name fragment (uppercased, no spaces). */
function blockName(value: string): string {
  const s = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s.length > 0 ? s : "DEVICE";
}

/** Escape text for a DXF TEXT value: strip control chars, cap length. */
function dxfText(value: string): string {
  // DXF TEXT does not support newlines; collapse whitespace and trim.
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
}

/** A DXF writer accumulating (groupCode, value) pairs as lines. */
class DxfWriter {
  private lines: string[] = [];

  pair(code: number, value: string | number): void {
    this.lines.push(String(code));
    this.lines.push(typeof value === "number" ? formatNum(value) : value);
  }

  toString(): string {
    // DXF lines are CRLF-terminated by convention; LF is also accepted but CRLF
    // is the safest for AutoCAD.
    return this.lines.join("\r\n") + "\r\n";
  }
}

/** Format a number for DXF: fixed precision, no exponent, trim trailing zeros. */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  let s = n.toFixed(4);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, ".0");
  return s;
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

// --- Entity emitters --------------------------------------------------------

function emitLine(w: DxfWriter, layer: string, x1: number, y1: number, x2: number, y2: number): void {
  w.pair(0, "LINE");
  w.pair(8, layer);
  w.pair(10, x1);
  w.pair(20, y1);
  w.pair(11, x2);
  w.pair(21, y2);
}

function emitCircle(w: DxfWriter, layer: string, cx: number, cy: number, r: number): void {
  w.pair(0, "CIRCLE");
  w.pair(8, layer);
  w.pair(10, cx);
  w.pair(20, cy);
  w.pair(40, r);
}

/**
 * Emit a TEXT entity. `halign`: 0 left, 1 center, 2 right (group 72). When not
 * left-aligned DXF requires the alignment point in group 11/21 too.
 */
function emitText(
  w: DxfWriter,
  layer: string,
  x: number,
  y: number,
  height: number,
  value: string,
  halign = 0
): void {
  w.pair(0, "TEXT");
  w.pair(8, layer);
  w.pair(10, x);
  w.pair(20, y);
  w.pair(40, height);
  w.pair(1, dxfText(value));
  if (halign !== 0) {
    w.pair(72, halign);
    w.pair(11, x);
    w.pair(21, y);
  }
}

function emitRect(w: DxfWriter, layer: string, x: number, y: number, width: number, height: number): void {
  // A closed LWPOLYLINE (R2000+) rectangle.
  w.pair(0, "LWPOLYLINE");
  w.pair(8, layer);
  w.pair(90, 4); // vertex count
  w.pair(70, 1); // closed
  for (const [px, py] of [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height]
  ]) {
    w.pair(10, px);
    w.pair(20, py);
  }
}

/**
 * Emit the body of one device BLOCK at local origin (0,0). Returns the block's
 * bounding width/height so callers can lay blocks out and set drawing extents.
 */
function emitBlockBody(w: DxfWriter, view: DeviceView): { width: number; height: number } {
  const terms = expandConnectors(view);
  const { left, right } = partition(terms);
  const h = bodyHeight(left, right);

  // Outline rectangle + title.
  emitRect(w, LAYER_DEVICE, 0, 0, BODY_WIDTH, h);
  emitText(w, LAYER_DEVICE, BODY_WIDTH / 2, h - TITLE_BAND + 3, TITLE_TEXT_H, deviceTitle(view.device), 1);

  // Terminals: rows distributed top-down inside the body (below the title band).
  const topY = h - TITLE_BAND - ROW_PITCH / 2;
  const placeColumn = (col: ExpandedConnector[], side: "left" | "right") => {
    for (let i = 0; i < col.length; i++) {
      const t = col[i];
      const y = topY - i * ROW_PITCH;
      const edgeX = side === "left" ? 0 : BODY_WIDTH;
      const tipX = side === "left" ? -STUB_LEN : BODY_WIDTH + STUB_LEN;
      // Terminal stub + circle.
      emitLine(w, LAYER_PORTS, edgeX, y, tipX, y);
      emitCircle(w, LAYER_PORTS, tipX, y, TERMINAL_R);
      // Label: port label + " (" + signalType-or-connector + ")".
      const label = `${t.label} (${portTypeLabel(t)})`;
      if (side === "left") {
        // Right-aligned, ending just left of the terminal circle.
        emitText(w, LAYER_PORTS, tipX - TERMINAL_R - LABEL_GAP, y - PORT_TEXT_H / 2, PORT_TEXT_H, label, 2);
      } else {
        emitText(w, LAYER_PORTS, tipX + TERMINAL_R + LABEL_GAP, y - PORT_TEXT_H / 2, PORT_TEXT_H, label, 0);
      }
    }
  };
  placeColumn(left, "left");
  placeColumn(right, "right");

  return { width: BODY_WIDTH, height: h };
}

// --- Section writers --------------------------------------------------------

function writeHeader(w: DxfWriter, extMaxX: number, extMaxY: number): void {
  w.pair(0, "SECTION");
  w.pair(2, "HEADER");
  w.pair(9, "$ACADVER");
  w.pair(1, "AC1015"); // AutoCAD 2000
  w.pair(9, "$INSUNITS");
  w.pair(70, 4); // millimetres
  w.pair(9, "$EXTMIN");
  w.pair(10, -STUB_LEN - 60);
  w.pair(20, -20);
  w.pair(9, "$EXTMAX");
  w.pair(10, extMaxX + 60);
  w.pair(20, extMaxY + 10);
  w.pair(0, "ENDSEC");
}

function writeTables(w: DxfWriter): void {
  w.pair(0, "SECTION");
  w.pair(2, "TABLES");
  // LAYER table with two layers.
  w.pair(0, "TABLE");
  w.pair(2, "LAYER");
  w.pair(70, 2);
  for (const [name, color] of [
    [LAYER_DEVICE, 7], // white/black
    [LAYER_PORTS, 5] // blue
  ] as const) {
    w.pair(0, "LAYER");
    w.pair(2, name);
    w.pair(70, 0);
    w.pair(62, color);
    w.pair(6, "CONTINUOUS");
  }
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");
}

interface BlockDef {
  name: string;
  view: DeviceView;
  insertX: number;
  width: number;
  height: number;
}

function writeBlocks(w: DxfWriter, blocks: BlockDef[]): void {
  w.pair(0, "SECTION");
  w.pair(2, "BLOCKS");
  for (const b of blocks) {
    w.pair(0, "BLOCK");
    w.pair(8, LAYER_DEVICE);
    w.pair(2, b.name);
    w.pair(70, 0);
    w.pair(10, 0);
    w.pair(20, 0);
    w.pair(3, b.name);
    emitBlockBody(w, b.view);
    w.pair(0, "ENDBLK");
    w.pair(8, LAYER_DEVICE);
  }
  w.pair(0, "ENDSEC");
}

function writeEntities(w: DxfWriter, blocks: BlockDef[], cables: { label: string }[]): void {
  w.pair(0, "SECTION");
  w.pair(2, "ENTITIES");
  for (const b of blocks) {
    w.pair(0, "INSERT");
    w.pair(8, LAYER_DEVICE);
    w.pair(2, b.name);
    w.pair(10, b.insertX);
    w.pair(20, 0);
    w.pair(30, 0);
  }
  // Cables: list as TEXT annotations beneath the row.
  let cy = -16;
  for (const c of cables) {
    emitText(w, LAYER_DEVICE, 0, cy, PORT_TEXT_H, c.label, 0);
    cy -= ROW_PITCH * 0.8;
  }
  w.pair(0, "ENDSEC");
}

function buildDxf(blocks: BlockDef[], cables: { label: string }[]): string {
  const extMaxX = blocks.reduce((m, b) => Math.max(m, b.insertX + b.width), 0);
  const extMaxY = blocks.reduce((m, b) => Math.max(m, b.height), 0);
  const w = new DxfWriter();
  writeHeader(w, extMaxX, extMaxY);
  writeTables(w);
  writeBlocks(w, blocks);
  writeEntities(w, blocks, cables);
  w.pair(0, "EOF");
  return w.toString();
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
    const blocks: BlockDef[] = [];
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
      // Measure the body to know width/height for layout + extents.
      const probe = new DxfWriter();
      const dims = emitBlockBody(probe, view);
      const insertX = blocks.reduce((m, b) => Math.max(m, b.insertX + b.width + BLOCK_GAP), 0);
      blocks.push({ name: unique, view, insertX, width: dims.width, height: dims.height });
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
      // A standalone cable has no device block; render it as a labeled stub box
      // so the file is still a valid, openable drawing.
      const cable = (device as unknown as { cable: CableBody }).cable;
      cables.push({ label: cableLabel(cable, 1) });
      // Provide a placeholder block so the drawing has at least one entity row.
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
