// AutoCAD DXF adapter (target "dxf", .dxf).
//
// Renders each ODIO device as an AVCAD-style schematic CAD BLOCK: a titled
// rectangle with a header band (manufacturer + model + a power summary) and two
// columns of I/O rows — inputs on the left edge, outputs/bidirectional on the
// right. Each row is a two-line label (port name over connector type, e.g.
// "HDMI IN 1" / "HDMI") sitting just inside the box, with a stub line + terminal
// marker hanging off the matching edge. Content comes from the shared block model
// (src/block.ts) so DXF and Visio render the same blocks.
//
// The DXF is produced by @tarikjabiri/dxf — a maintained writer that emits a
// structurally complete file (HEADER with handles, TABLES, BLOCKS, ENTITIES,
// OBJECTS, EOF). We override $ACADVER to AC1027 (AutoCAD 2013); AutoCAD 2018
// (AC1032) opens it natively.
//
// Layout (drawing units treated as millimetres):
//   - one BLOCK per device: an outline rectangle auto-sized to the row count and
//     the longest label; a header band (title + power subtitle) separated by a
//     rule; per connector a two-line label inside the box, a stub LINE and a
//     terminal CIRCLE outside the edge.
//   - each block is INSERTed into model space; bundles INSERT one block per leaf
//     device laid out in a row. Cables are listed as TEXT annotations beneath the
//     row (a full wiring diagram is out of scope for a block library).

import {
  validateDocument,
  flattenBundle,
  formatErrors,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice
} from "@opendeviceio/sdk";

import { DxfWriter, point3d, Units, type DxfBlock } from "@tarikjabiri/dxf";

import type { Adapter, AdapterResult } from "./types.js";
import { buildBlockModel, type BlockModel, type BlockPort } from "./block.js";

// --- Layout constants (drawing units; treat as millimetres) ----------------
const TITLE_TEXT_H = 4.0; // device title in the header band
const SUBTITLE_TEXT_H = 2.3; // power summary under the title
const NAME_TEXT_H = 2.6; // port name (first label line)
const TYPE_TEXT_H = 2.0; // connector type (second label line)
const ROW_PITCH = 9; // vertical spacing between port rows
const HEADER_BAND = 13; // height reserved at the top for title + subtitle
const BOTTOM_PAD = 5; // padding below the last row
const STUB_LEN = 7; // length of the terminal stub outside the box
const TERMINAL_R = 1.0; // radius of the terminal circle
const EDGE_PAD = 3; // gap from a box edge to its label text
const COL_GAP = 10; // min clear gap between the left and right label columns
const LINE_OFFSET = 1.9; // half the gap between a row's two label lines
const MIN_BODY_WIDTH = 64;
const MAX_BODY_WIDTH = 220;
// Conservative glyph-width fraction. AutoCAD's STANDARD text style can resolve to
// fonts noticeably wider than a naive 0.6; we size boxes AND truncate labels with
// the same generous factor so text fits by construction regardless of the host
// font (real width <= this => no overflow).
const CHAR_W = 0.82;
const BLOCK_GAP = 40; // horizontal gap between blocks in a bundle row

const LAYER_DEVICE = "DEVICE";
const LAYER_PORTS = "PORTS";
const LAYER_TEXT = "TEXT";

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

/**
 * Sanitise text for a DXF TEXT value: collapse whitespace, map the few non-ASCII
 * separators we emit to ASCII (AutoCAD's default SHX fonts don't render them
 * reliably), drop any remaining non-ASCII, and cap length.
 */
function dxfText(value: string): string {
  const clean = value
    .replace(/[·•]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
}

/** The device identity + ports + power the DXF adapter reads. */
interface DeviceIdentity {
  manufacturer?: string;
  model?: string;
}
type DeviceView = {
  device: DeviceIdentity;
  ports: OdioDevice["ports"];
  power?: OdioDevice["power"];
};

/** Estimated rendered width of a text string at a given text height. */
function textWidth(s: string, h: number): number {
  return s.length * h * CHAR_W;
}

type Justify = "left" | "center" | "right";

/**
 * Place a DXF TEXT with the default left/baseline justification, computing the
 * insertion point ourselves. We deliberately do NOT use the writer's
 * horizontal/vertical alignment options: those set group codes 72/73 but the
 * library omits the required second alignment point (11/21), so AutoCAD ignores
 * 10/20 and stacks every justified label at the origin. With default
 * justification, 10/20 is authoritative. `yMid` is the row's vertical centre; we
 * drop the baseline by ~0.36·h to visually centre the cap height.
 */
function placeText(
  block: DxfBlock,
  x: number,
  yMid: number,
  h: number,
  raw: string,
  layer: string,
  justify: Justify,
  maxWidth?: number
): void {
  let s = dxfText(raw);
  if (maxWidth !== undefined) s = truncateToWidth(s, h, maxWidth);
  let tx = x;
  if (justify === "center") tx = x - textWidth(s, h) / 2;
  else if (justify === "right") tx = x - textWidth(s, h);
  block.addText(point3d(tx, yMid - h * 0.36, 0), h, s, { layerName: layer });
}

/** Truncate `s` (already dxf-sanitised) so its rendered width fits `maxWidth`. */
function truncateToWidth(s: string, h: number, maxWidth: number): string {
  const maxChars = Math.max(1, Math.floor(maxWidth / (h * CHAR_W)));
  if (s.length <= maxChars) return s;
  return maxChars <= 2 ? s.slice(0, maxChars) : `${s.slice(0, maxChars - 2)}..`;
}

/** Widest rendered extent of a column's two-line labels (0 for an empty column). */
function columnWidth(col: BlockPort[]): number {
  let w = 0;
  for (const p of col) {
    w = Math.max(w, textWidth(p.name, NAME_TEXT_H), textWidth(p.type, TYPE_TEXT_H));
  }
  return w;
}

/** Block bounding size derived from the model's rows + label/title widths. */
function blockDims(model: BlockModel): { width: number; height: number } {
  const rows = Math.max(model.left.length, model.right.length, 1);
  const height = HEADER_BAND + rows * ROW_PITCH + BOTTOM_PAD;

  // Width must fit both label columns side-by-side (with a clear gap) AND the
  // title/subtitle, all measured with the conservative CHAR_W.
  const contentW = EDGE_PAD * 2 + columnWidth(model.left) + columnWidth(model.right) + COL_GAP;
  const titleW = textWidth(model.title, TITLE_TEXT_H) + EDGE_PAD * 2;
  const subtitleW = model.subtitle ? textWidth(model.subtitle, SUBTITLE_TEXT_H) + EDGE_PAD * 2 : 0;
  const width = Math.min(
    MAX_BODY_WIDTH,
    Math.max(MIN_BODY_WIDTH, contentW, titleW, subtitleW)
  );
  return { width, height };
}

/**
 * Draw one device block into `block` at the block's local origin (0,0). Returns
 * the bounding width/height so callers can lay blocks out in a row and compute
 * extents. Recomputes dims from the same model so drawing and layout agree.
 */
function drawBlockBody(block: DxfBlock, view: DeviceView): { width: number; height: number } {
  const model = buildBlockModel(view);
  const { width: W, height: H } = blockDims(model);

  // Outline rectangle (top-left .. bottom-right) on the DEVICE layer.
  block.addRectangle({ x: 0, y: H }, { x: W, y: 0 }, { layerName: LAYER_DEVICE });

  // Header band: a rule separating the title area from the rows.
  const bandY = H - HEADER_BAND;
  block.addLine(point3d(0, bandY, 0), point3d(W, bandY, 0), { layerName: LAYER_DEVICE });

  // Title (centred) and, if present, the power subtitle beneath it — clamped to
  // the interior so they never overrun the box edges.
  const headerBudget = W - EDGE_PAD * 2;
  const titleY = model.subtitle ? H - 4.8 : H - HEADER_BAND / 2;
  placeText(block, W / 2, titleY, TITLE_TEXT_H, model.title, LAYER_TEXT, "center", headerBudget);
  if (model.subtitle) {
    placeText(block, W / 2, H - 9.6, SUBTITLE_TEXT_H, model.subtitle, LAYER_TEXT, "center", headerBudget);
  }

  // Per-side label budgets: split the interior (minus the centre gap) in
  // proportion to each column's natural width, so labels truncate to their own
  // share and can neither overrun an edge nor collide across the centre.
  const leftColW = columnWidth(model.left);
  const rightColW = columnWidth(model.right);
  const interior = Math.max(0, W - EDGE_PAD * 2 - COL_GAP);
  const totalColW = leftColW + rightColW || 1;
  const leftBudget = model.left.length ? Math.max(8, (interior * leftColW) / totalColW) : 0;
  const rightBudget = model.right.length ? Math.max(8, (interior * rightColW) / totalColW) : 0;

  const topRowY = H - HEADER_BAND - ROW_PITCH / 2;

  const placeColumn = (col: BlockPort[], side: "left" | "right") => {
    const budget = side === "left" ? leftBudget : rightBudget;
    for (let i = 0; i < col.length; i++) {
      const p = col[i];
      const y = topRowY - i * ROW_PITCH;
      const edgeX = side === "left" ? 0 : W;
      const tipX = side === "left" ? -STUB_LEN : W + STUB_LEN;

      // Stub line + terminal circle hanging off the matching edge.
      block.addLine(point3d(edgeX, y, 0), point3d(tipX, y, 0), { layerName: LAYER_PORTS });
      block.addCircle(point3d(tipX, y, 0), TERMINAL_R, { layerName: LAYER_PORTS });

      // Two-line label INSIDE the box: name over connector type, truncated to the
      // column budget.
      const labelX = side === "left" ? EDGE_PAD : W - EDGE_PAD;
      const justify: Justify = side === "left" ? "left" : "right";
      placeText(block, labelX, y + LINE_OFFSET, NAME_TEXT_H, p.name, LAYER_TEXT, justify, budget);
      placeText(block, labelX, y - LINE_OFFSET, TYPE_TEXT_H, p.type, LAYER_PORTS, justify, budget);
    }
  };
  placeColumn(model.left, "left");
  placeColumn(model.right, "right");

  return { width: W, height: H };
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
 * Build the whole DXF document from a planned list of block placements and a list
 * of cable annotation labels.
 */
function buildDxf(blocks: BlockPlacement[], cables: { label: string }[]): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable("$ACADVER", { 1: ACAD_VERSION });

  // Layers: DEVICE (white/7 — outline + rule), PORTS (blue/5 — stubs + type), TEXT
  // (cyan/4 — title + port names).
  dxf.addLayer(LAYER_DEVICE, 7, "Continuous");
  dxf.addLayer(LAYER_PORTS, 5, "Continuous");
  dxf.addLayer(LAYER_TEXT, 4, "Continuous");

  // One BLOCK definition per device.
  for (const b of blocks) {
    const block = dxf.addBlock(b.name);
    drawBlockBody(block, b.view);
  }

  // INSERT each block into model space at its row position.
  for (const b of blocks) {
    dxf.addInsert(b.name, point3d(b.insertX, 0, 0), { layerName: LAYER_DEVICE });
  }

  // Cables: list as TEXT annotations beneath the row, in model space. Default
  // left/baseline justification (no 72/73) so 10/20 positions the text.
  let cy = -16;
  for (const c of cables) {
    dxf.addText(point3d(0, cy - TYPE_TEXT_H, 0), TYPE_TEXT_H, dxfText(c.label), {
      layerName: LAYER_TEXT
    });
    cy -= ROW_PITCH * 0.8;
  }

  // Drawing extents so AutoCAD opens zoomed to the content.
  const extMaxX = blocks.reduce((m, b) => Math.max(m, b.insertX + b.width), MIN_BODY_WIDTH);
  const extMaxY = blocks.reduce((m, b) => Math.max(m, b.height), HEADER_BAND);
  const extMinY = Math.min(-20, cy);
  dxf.setVariable("$EXTMIN", { 10: -STUB_LEN - 80, 20: extMinY, 30: 0 });
  dxf.setVariable("$EXTMAX", { 10: extMaxX + 80, 20: extMaxY + 10, 30: 0 });

  return dxf.stringify();
}

/**
 * The AutoCAD DXF adapter. Validates the input via the SDK, then renders one BLOCK
 * per device (laid out in a row for bundles) with an AVCAD-style header band and
 * labeled I/O terminals.
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
      let unique = name;
      let n = 1;
      while (blocks.some((b) => b.name === unique)) {
        unique = `${name}_${++n}`;
      }
      const { width, height } = blockDims(buildBlockModel(view));
      const insertX = blocks.reduce((m, b) => Math.max(m, b.insertX + b.width + BLOCK_GAP), 0);
      blocks.push({ name: unique, view, insertX, width, height });
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
          addDevice({ device: view.device, ports: view.ports, power: view.power }, seed);
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
      // A standalone cable has no device block; render it as a labeled box so the
      // file is still a valid, openable drawing.
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
