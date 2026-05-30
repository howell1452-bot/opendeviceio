// AutoCAD DXF adapter (target "dxf", .dxf).
//
// Thin renderer over the host-agnostic DrawProgram (src/drawops.ts): the block
// layout lives there (single source for DXF + the native add-ins), and this file
// only translates DrawOps into DXF entities and arranges the per-device blocks in
// a row. Produced by @tarikjabiri/dxf (a real writer; declares AutoCAD 2013 /
// AC1027, which 2018 opens natively).
//
// Text: we never use the writer's justification options — it omits the required
// second alignment point (11/21), so AutoCAD ignores 10/20 and stacks justified
// text at the origin. Instead we place every TEXT with default left/baseline
// justification and compute x (left/center/right) + baseline y ourselves, using
// the same CHAR_W as the layout so truncation and sizing agree.

import { DxfWriter, point3d, Units, type DxfBlock } from "@tarikjabiri/dxf";

import type { OdioDevice } from "@opendeviceio/sdk";
import type { Adapter, AdapterResult } from "./types.js";
import {
  buildDevicePrograms,
  truncateToWidth,
  textWidth,
  type DrawProgram,
  type DrawOp,
  LAYER_DEVICE,
  LAYER_PORTS,
  LAYER_TEXT
} from "./drawops.js";

const ACAD_VERSION = "AC1027"; // AutoCAD 2013 interchange; 2018 opens it natively.
const BLOCK_GAP = 40; // horizontal gap between device blocks in a row (mm)
const STUB_MARGIN = 80; // model-space margin (mm) for stubs/labels in the extents

/** Slugify into a DXF-safe block-name fragment (uppercased, no spaces). */
function blockName(value: string): string {
  const s = value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s.length > 0 ? s : "DEVICE";
}

/** Sanitise text for a DXF TEXT value: map non-ASCII separators to ASCII, drop the
 * rest, collapse whitespace, cap length. */
function dxfText(value: string): string {
  const clean = value
    .replace(/[·•]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
}

/** Render one DrawOp into a DXF block at the block's local origin. */
function renderOp(block: DxfBlock, op: DrawOp): void {
  switch (op.op) {
    case "rect":
      block.addRectangle({ x: op.x, y: op.y + op.h }, { x: op.x + op.w, y: op.y }, { layerName: op.layer });
      return;
    case "line":
      block.addLine(point3d(op.x1, op.y1, 0), point3d(op.x2, op.y2, 0), { layerName: op.layer });
      return;
    case "circle":
      block.addCircle(point3d(op.x, op.y, 0), op.r, { layerName: op.layer });
      return;
    case "connection":
      // DXF has no connection-point primitive; the stub line + terminal circle
      // already mark it. (Visio/InDesign add-ins use this op.)
      return;
    case "text": {
      let s = dxfText(op.value);
      if (op.maxWidth !== undefined) s = truncateToWidth(s, op.h, op.maxWidth);
      let tx = op.x;
      if (op.align === "center") tx = op.x - textWidth(s, op.h) / 2;
      else if (op.align === "right") tx = op.x - textWidth(s, op.h);
      const ty = op.valign === "middle" ? op.y - op.h * 0.36 : op.y;
      block.addText(point3d(tx, ty, 0), op.h, s, { layerName: op.layer });
      return;
    }
  }
}

interface Placement {
  name: string;
  program: DrawProgram;
  insertX: number;
}

function buildDxf(programs: DrawProgram[], cables: { label: string }[]): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable("$ACADVER", { 1: ACAD_VERSION });
  dxf.addLayer(LAYER_DEVICE, 7, "Continuous"); // white — outline + rule
  dxf.addLayer(LAYER_PORTS, 5, "Continuous"); // blue — stubs/terminals + type
  dxf.addLayer(LAYER_TEXT, 4, "Continuous"); // cyan — title + port names

  // Plan block names (de-collided) + row positions.
  const placements: Placement[] = [];
  let cursor = 0;
  const used = new Set<string>();
  for (const program of programs) {
    let name = blockName(program.title);
    let n = 1;
    while (used.has(name)) name = `${blockName(program.title)}_${++n}`;
    used.add(name);
    placements.push({ name, program, insertX: cursor });
    cursor += program.width + BLOCK_GAP;
  }

  for (const p of placements) {
    const block = dxf.addBlock(p.name);
    for (const op of p.program.ops) renderOp(block, op);
  }
  for (const p of placements) {
    dxf.addInsert(p.name, point3d(p.insertX, 0, 0), { layerName: LAYER_DEVICE });
  }

  // Cables: TEXT annotations beneath the row (default left/baseline justification).
  let cy = -16;
  for (const c of cables) {
    dxf.addText(point3d(0, cy - 2, 0), 2.0, dxfText(c.label), { layerName: LAYER_TEXT });
    cy -= 7.2;
  }

  const extMaxX = placements.reduce((m, p) => Math.max(m, p.insertX + p.program.width), 64);
  const extMaxY = placements.reduce((m, p) => Math.max(m, p.program.height), 13);
  dxf.setVariable("$EXTMIN", { 10: -STUB_MARGIN, 20: Math.min(-20, cy), 30: 0 });
  dxf.setVariable("$EXTMAX", { 10: extMaxX + STUB_MARGIN, 20: extMaxY + 10, 30: 0 });
  return dxf.stringify();
}

/**
 * The AutoCAD DXF adapter. Validates via the SDK (inside buildDevicePrograms),
 * then renders the per-device DrawPrograms into a single drawing, blocks in a row.
 */
export const DxfAdapter: Adapter = {
  id: "dxf",
  label: "AutoCAD DXF (schematic block)",
  fileExtension: "dxf",

  export(device: OdioDevice): AdapterResult {
    const { programs, cables, warnings, fileBase } = buildDevicePrograms(device);
    if (programs.length === 0) {
      throw new Error("DXF adapter: document expanded to zero device blocks.");
    }
    const content = buildDxf(programs, cables);
    return { files: [{ path: `${fileBase}.dxf`, content }], warnings };
  }
};
