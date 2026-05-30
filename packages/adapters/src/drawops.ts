// Host-agnostic "draw program" for an ODIO schematic block.
//
// buildDevicePrograms() turns an ODIO document into one or more DrawProgram — an
// ordered list of primitive ops (rect, line, circle, text, connection point) in a
// normalized millimetre space with the origin at the block's bottom-left and Y up.
// This is the SINGLE source of the AVCAD-style block layout: the DXF adapter
// renders it, and the native AutoCAD / Visio / InDesign add-ins consume the same
// JSON (each host applies its own unit scale / Y-flip and font fitting), so every
// surface draws identical blocks. Text ops carry `maxWidth` so each host truncates
// with its own font metrics; the DXF renderer uses CHAR_W (exported here) so its
// box sizing and truncation share one estimate.

import {
  validateDocument,
  flattenBundle,
  formatErrors,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice
} from "@opendeviceio/sdk";

import { buildBlockModel, blockTitle, type BlockModel, type BlockPort } from "./block.js";

// --- Layout constants (millimetres) -----------------------------------------
export const TITLE_TEXT_H = 4.0;
export const SUBTITLE_TEXT_H = 2.3;
export const NAME_TEXT_H = 2.6;
export const TYPE_TEXT_H = 2.0;
const ROW_PITCH = 9;
const HEADER_BAND = 13;
const BOTTOM_PAD = 5;
const STUB_LEN = 7;
const TERMINAL_R = 1.0;
const EDGE_PAD = 3;
const COL_GAP = 10;
const LINE_OFFSET = 1.9;
const MIN_BODY_WIDTH = 64;
const MAX_BODY_WIDTH = 220;
/** Glyph-width fraction used for box sizing + label fitting (see dxf.ts note). */
export const CHAR_W = 0.95;

/** Layer hints (the DXF renderer maps these; other hosts may ignore them). */
export const LAYER_DEVICE = "DEVICE";
export const LAYER_PORTS = "PORTS";
export const LAYER_TEXT = "TEXT";

export type DrawAlign = "left" | "center" | "right";

/** One primitive in a {@link DrawProgram} (mm, origin bottom-left, Y up). */
export type DrawOp =
  | { op: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke: boolean; layer: string }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; layer: string }
  | { op: "circle"; x: number; y: number; r: number; layer: string }
  | {
      op: "text";
      x: number;
      y: number;
      h: number;
      value: string;
      align: DrawAlign;
      /** "middle" = vertically centre on y; "baseline" = y is the text baseline. */
      valign: "middle" | "baseline";
      bold?: boolean;
      /** Host should truncate `value` to this rendered width (mm). */
      maxWidth?: number;
      layer: string;
    }
  | { op: "connection"; x: number; y: number; label: string };

/** A complete block as host-agnostic ops. */
export interface DrawProgram {
  units: "mm";
  /** Block bounding width/height (mm). */
  width: number;
  height: number;
  /** Block title (manufacturer + model), for naming/labelling by the host. */
  title: string;
  ops: DrawOp[];
}

/** Estimated rendered width of a string at text height `h` (mm). */
export function textWidth(s: string, h: number): number {
  return s.length * h * CHAR_W;
}

/** Truncate `s` so its rendered width fits `maxWidth` (mm), with a ".." suffix. */
export function truncateToWidth(s: string, h: number, maxWidth: number): string {
  const maxChars = Math.max(1, Math.floor(maxWidth / (h * CHAR_W)));
  if (s.length <= maxChars) return s;
  return maxChars <= 2 ? s.slice(0, maxChars) : `${s.slice(0, maxChars - 2)}..`;
}

function columnWidth(col: BlockPort[]): number {
  let w = 0;
  for (const p of col) w = Math.max(w, textWidth(p.name, NAME_TEXT_H), textWidth(p.type, TYPE_TEXT_H));
  return w;
}

/** Block bounding size from the model's rows + label/title widths. */
export function blockDims(model: BlockModel): { width: number; height: number } {
  const rows = Math.max(model.left.length, model.right.length, 1);
  const height = HEADER_BAND + rows * ROW_PITCH + BOTTOM_PAD;
  const contentW = EDGE_PAD * 2 + columnWidth(model.left) + columnWidth(model.right) + COL_GAP;
  const titleW = textWidth(model.title, TITLE_TEXT_H) + EDGE_PAD * 2;
  const subtitleW = model.subtitle ? textWidth(model.subtitle, SUBTITLE_TEXT_H) + EDGE_PAD * 2 : 0;
  const width = Math.min(MAX_BODY_WIDTH, Math.max(MIN_BODY_WIDTH, contentW, titleW, subtitleW));
  return { width, height };
}

interface DeviceView {
  device: { manufacturer?: string; model?: string };
  ports: OdioDevice["ports"];
  power?: OdioDevice["power"];
}

/** Build the AVCAD-style block for one device as a {@link DrawProgram}. */
export function buildDeviceProgram(view: DeviceView, titleOverride?: string): DrawProgram {
  const model = buildBlockModel(view);
  const { width: W, height: H } = blockDims(model);
  const ops: DrawOp[] = [];

  // Outline + header rule.
  ops.push({ op: "rect", x: 0, y: 0, w: W, h: H, stroke: true, layer: LAYER_DEVICE });
  const bandY = H - HEADER_BAND;
  ops.push({ op: "line", x1: 0, y1: bandY, x2: W, y2: bandY, layer: LAYER_DEVICE });

  // Title + power subtitle, centred in the header band, clamped to the interior.
  const headerBudget = W - EDGE_PAD * 2;
  const titleY = model.subtitle ? H - 4.8 : H - HEADER_BAND / 2;
  ops.push({ op: "text", x: W / 2, y: titleY, h: TITLE_TEXT_H, value: model.title, align: "center", valign: "middle", bold: true, maxWidth: headerBudget, layer: LAYER_TEXT });
  if (model.subtitle) {
    ops.push({ op: "text", x: W / 2, y: H - 9.6, h: SUBTITLE_TEXT_H, value: model.subtitle, align: "center", valign: "middle", maxWidth: headerBudget, layer: LAYER_TEXT });
  }

  // Per-side label budgets (interior split in proportion to each column's width).
  const leftColW = columnWidth(model.left);
  const rightColW = columnWidth(model.right);
  const interior = Math.max(0, W - EDGE_PAD * 2 - COL_GAP);
  const totalColW = leftColW + rightColW || 1;
  const leftBudget = model.left.length ? Math.max(8, (interior * leftColW) / totalColW) : 0;
  const rightBudget = model.right.length ? Math.max(8, (interior * rightColW) / totalColW) : 0;

  const topRowY = H - HEADER_BAND - ROW_PITCH / 2;
  const placeColumn = (col: BlockPort[], side: "left" | "right") => {
    const budget = side === "left" ? leftBudget : rightBudget;
    const labelX = side === "left" ? EDGE_PAD : W - EDGE_PAD;
    const align: DrawAlign = side === "left" ? "left" : "right";
    const edgeX = side === "left" ? 0 : W;
    const tipX = side === "left" ? -STUB_LEN : W + STUB_LEN;
    for (let i = 0; i < col.length; i++) {
      const p = col[i];
      const y = topRowY - i * ROW_PITCH;
      ops.push({ op: "line", x1: edgeX, y1: y, x2: tipX, y2: y, layer: LAYER_PORTS });
      ops.push({ op: "circle", x: tipX, y, r: TERMINAL_R, layer: LAYER_PORTS });
      ops.push({ op: "connection", x: tipX, y, label: p.name });
      ops.push({ op: "text", x: labelX, y: y + LINE_OFFSET, h: NAME_TEXT_H, value: p.name, align, valign: "middle", maxWidth: budget, layer: LAYER_TEXT });
      ops.push({ op: "text", x: labelX, y: y - LINE_OFFSET, h: TYPE_TEXT_H, value: p.type, align, valign: "middle", maxWidth: budget, layer: LAYER_PORTS });
    }
  };
  placeColumn(model.left, "left");
  placeColumn(model.right, "right");

  return { units: "mm", width: W, height: H, title: titleOverride ?? model.title, ops };
}

export interface CableAnnotation {
  label: string;
}

/** Programs + cable annotations for a whole document (device/bundle/cable). */
export interface DocumentPrograms {
  programs: DrawProgram[];
  cables: CableAnnotation[];
  warnings: string[];
  /** Filename-safe base derived from the document identity. */
  fileBase: string;
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "device";
}

function cableLabel(cable: CableBody, qty: number): string {
  const base = `${cable.manufacturer ?? ""} ${cable.model ?? cable.sku ?? cable.label ?? "cable"}`.trim();
  const ends = (cable.ends ?? []).map((e) => (e as { connector?: string }).connector ?? "?").join(" <-> ");
  const q = qty > 1 ? ` x${qty}` : "";
  return `CABLE: ${base}${q}${ends ? ` [${ends}]` : ""}`;
}

/**
 * Validate the document and build a {@link DrawProgram} per device block: one for
 * a device, one per leaf-device-unit for a bundle (chassis cards labelled by slot),
 * and a labelled empty box for a standalone cable.
 */
export function buildDevicePrograms(document: OdioDevice): DocumentPrograms {
  const routed = validateDocument(document);
  if (!routed.valid) {
    throw new Error(
      `DrawOps: input is not a valid OpenDeviceIO ${routed.kind} document:\n${formatErrors(routed.errors)}`
    );
  }

  const programs: DrawProgram[] = [];
  const cables: CableAnnotation[] = [];
  const warnings: string[] = [];

  if (routed.kind === "bundle") {
    const bundle = document as unknown as Bundle;
    const flat = flattenBundle(bundle);
    for (const entry of flat.devices) {
      const v = entry.device as FlattenedDevice & { slot?: string };
      if (!v.device?.manufacturer || !v.device?.model) {
        warnings.push(`Bundle leaf "${entry.path.join(" / ")}": missing manufacturer/model; skipped.`);
        continue;
      }
      const base = blockTitle(v.device);
      const slot = entry.slot;
      const qty = entry.quantity >= 1 ? entry.quantity : 1;
      for (let unit = 1; unit <= qty; unit++) {
        const suffix = qty > 1 ? ` #${unit}` : "";
        const title = (slot ? `${base} [${slot}]` : base) + suffix;
        programs.push(buildDeviceProgram({ device: v.device, ports: v.ports, power: v.power }, title));
      }
    }
    for (const entry of flat.cables) cables.push({ label: cableLabel(entry.cable as CableBody, entry.quantity) });
    for (const ref of flat.unresolvedRefs) warnings.push(`Unresolved ${ref.type} reference at "${ref.path.join(" / ")}".`);
    return { programs, cables, warnings, fileBase: fileSlug(`${bundle.bundle?.manufacturer ?? ""}-${bundle.bundle?.model ?? "bundle"}`) };
  }

  if (routed.kind === "cable") {
    const cable = (document as unknown as { cable: CableBody }).cable;
    cables.push({ label: cableLabel(cable, 1) });
    programs.push(buildDeviceProgram({ device: { manufacturer: cable.manufacturer, model: cable.model ?? cable.label }, ports: [] as never }));
    return { programs, cables, warnings, fileBase: fileSlug(`${cable.manufacturer ?? ""}-${cable.model ?? cable.label ?? "cable"}`) };
  }

  const view = document as unknown as DeviceView;
  programs.push(buildDeviceProgram(view));
  return { programs, cables, warnings, fileBase: fileSlug(`${view.device?.manufacturer ?? ""}-${view.device?.model ?? "device"}`) };
}
