// ODIO I/O-table renderer — SVG target ("table-svg", .svg).
//
// Renders the standardized I/O-table projection (src/table.ts) as a self-contained
// vector SVG a manufacturer can drop straight onto a spec sheet (InDesign/Word/PDF)
// and that opens in any browser. Pure string output, no dependencies. The layout is
// deterministic: column widths are sized to content, rows are grouped Inputs /
// Outputs / Bidirectional / Power, and bundles add a per-device heading band plus a
// components list.

import type { OdioDevice } from "@opendeviceio/sdk";
import type { Adapter, AdapterResult } from "./types.js";
import { buildIoTable, type IoTable, type IoTableRow } from "./table.js";

// --- Layout constants (px) --------------------------------------------------
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const TITLE_SIZE = 15;
const SUB_SIZE = 11;
const HEAD_SIZE = 10.5;
const CELL_SIZE = 11;
const GROUP_SIZE = 10;

const TITLE_H = 30;
const HEADER_H = 24;
const ROW_H = 20;
const GROUP_H = 19;
const CELL_PAD = 8;
const CHAR_W = 6.0; // approx glyph width at 11px for column sizing
const MARGIN = 1;

const C_TITLE_BG = "#1f2a37";
const C_TITLE_FG = "#ffffff";
const C_HEAD_BG = "#374151";
const C_HEAD_FG = "#ffffff";
const C_GROUP_BG = "#f2a93b";
const C_GROUP_FG = "#3b2a08";
const C_ZEBRA = "#f7f8fa";
const C_GRID = "#d6dae0";
const C_TEXT = "#1f2937";

interface Column {
  key: keyof Pick<IoTableRow, "label" | "dir" | "connector" | "link" | "signals">;
  header: string;
  width: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function allRows(table: IoTable): IoTableRow[] {
  return table.sections.flatMap((s) => s.rows);
}

/** Size each column to the widest of its header / cell values, within bounds. */
function computeColumns(table: IoTable): Column[] {
  const cols: Column[] = [
    { key: "label", header: "Label", width: 0 },
    { key: "dir", header: "Dir", width: 0 },
    { key: "connector", header: "Connector", width: 0 },
    { key: "link", header: "Link", width: 0 },
    { key: "signals", header: "Signals", width: 0 }
  ];
  const rows = allRows(table);
  const minW: Record<string, number> = { label: 90, dir: 38, connector: 76, link: 70, signals: 90 };
  const maxW: Record<string, number> = { label: 230, dir: 50, connector: 150, link: 240, signals: 280 };
  for (const c of cols) {
    let widest = c.header.length;
    for (const r of rows) widest = Math.max(widest, (r[c.key] ?? "").length);
    const px = widest * CHAR_W + CELL_PAD * 2;
    c.width = Math.round(Math.min(maxW[c.key], Math.max(minW[c.key], px)));
  }
  return cols;
}

/** Truncate a string to fit a column width (in px) with an ellipsis. */
function fit(s: string, widthPx: number): string {
  const maxChars = Math.max(1, Math.floor((widthPx - CELL_PAD * 2) / CHAR_W));
  return s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s;
}

/** A vertical-flow item in the rendered table. */
type Item =
  | { kind: "section"; text: string }
  | { kind: "group"; text: string }
  | { kind: "row"; row: IoTableRow; zebra: boolean }
  | { kind: "components"; comps: NonNullable<IoTable["components"]> };

function buildItems(table: IoTable): Item[] {
  const items: Item[] = [];
  const multi = table.sections.length > 1;
  for (const section of table.sections) {
    if (multi && section.heading) items.push({ kind: "section", text: section.heading });
    let lastGroup = "";
    let zebra = false;
    for (const row of section.rows) {
      if (row.group !== lastGroup) {
        items.push({ kind: "group", text: groupHeading(row.group) });
        lastGroup = row.group;
        zebra = false;
      }
      items.push({ kind: "row", row, zebra });
      zebra = !zebra;
    }
  }
  if (table.components && table.components.length > 0) {
    items.push({ kind: "components", comps: table.components });
  }
  return items;
}

function groupHeading(g: string): string {
  if (g === "Power") return "POWER";
  if (g === "Bidirectional") return "BIDIRECTIONAL";
  return `${g.toUpperCase()}S`; // Input -> INPUTS, Output -> OUTPUTS
}

/** Render the I/O table as a complete SVG document string. */
export function renderTableSvg(table: IoTable): string {
  const cols = computeColumns(table);
  const tableW = cols.reduce((s, c) => s + c.width, 0);
  const width = tableW + MARGIN * 2;
  const items = buildItems(table);

  const hasSub = !!table.subtitle;
  let y = MARGIN;
  const parts: string[] = [];

  // Title bar.
  const titleH = TITLE_H + (hasSub ? SUB_SIZE + 4 : 0);
  parts.push(rect(MARGIN, y, tableW, titleH, C_TITLE_BG));
  parts.push(
    text(MARGIN + CELL_PAD, y + 20, esc(table.title), {
      size: TITLE_SIZE,
      fill: C_TITLE_FG,
      weight: "700"
    })
  );
  if (hasSub) {
    parts.push(
      text(MARGIN + CELL_PAD, y + 20 + SUB_SIZE + 2, esc(table.subtitle ?? ""), {
        size: SUB_SIZE,
        fill: "#cbd5e1"
      })
    );
  }
  y += titleH;

  // Column header row.
  parts.push(rect(MARGIN, y, tableW, HEADER_H, C_HEAD_BG));
  let cx = MARGIN;
  for (const c of cols) {
    parts.push(
      text(cx + CELL_PAD, y + 16, esc(c.header), { size: HEAD_SIZE, fill: C_HEAD_FG, weight: "600" })
    );
    cx += c.width;
  }
  y += HEADER_H;

  // Body.
  for (const item of items) {
    if (item.kind === "section") {
      parts.push(rect(MARGIN, y, tableW, GROUP_H, "#111827"));
      parts.push(text(MARGIN + CELL_PAD, y + 14, esc(item.text), { size: GROUP_SIZE + 1, fill: "#ffffff", weight: "700" }));
      y += GROUP_H;
    } else if (item.kind === "group") {
      parts.push(rect(MARGIN, y, tableW, GROUP_H, C_GROUP_BG));
      parts.push(text(MARGIN + CELL_PAD, y + 14, esc(item.text), { size: GROUP_SIZE, fill: C_GROUP_FG, weight: "700" }));
      y += GROUP_H;
    } else if (item.kind === "row") {
      if (item.zebra) parts.push(rect(MARGIN, y, tableW, ROW_H, C_ZEBRA));
      cx = MARGIN;
      for (const c of cols) {
        const raw = item.row[c.key] ?? "";
        parts.push(text(cx + CELL_PAD, y + 14, esc(fit(raw, c.width)), { size: CELL_SIZE, fill: C_TEXT }));
        cx += c.width;
      }
      y += ROW_H;
    } else {
      // Components (bundle BOM).
      parts.push(rect(MARGIN, y, tableW, GROUP_H, "#111827"));
      parts.push(text(MARGIN + CELL_PAD, y + 14, "COMPONENTS", { size: GROUP_SIZE, fill: "#ffffff", weight: "700" }));
      y += GROUP_H;
      let zebra = false;
      for (const comp of item.comps) {
        if (zebra) parts.push(rect(MARGIN, y, tableW, ROW_H, C_ZEBRA));
        const line = `${comp.quantity}× ${comp.label}  (${comp.kind})`;
        parts.push(text(MARGIN + CELL_PAD, y + 14, esc(fit(line, tableW)), { size: CELL_SIZE, fill: C_TEXT }));
        y += ROW_H;
        zebra = !zebra;
      }
    }
  }

  const totalH = y + MARGIN;

  // Column separators + outer border, drawn over the fills.
  const lines: string[] = [];
  let lx = MARGIN;
  const gridTop = MARGIN + titleH;
  for (let i = 0; i < cols.length - 1; i++) {
    lx += cols[i].width;
    lines.push(vline(lx, gridTop, totalH - MARGIN));
  }
  lines.push(rectStroke(MARGIN, MARGIN, tableW, totalH - MARGIN * 2));

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" ` +
    `viewBox="0 0 ${width} ${totalH}" font-family="${FONT}">\n` +
    parts.join("\n") +
    "\n" +
    lines.join("\n") +
    "\n</svg>\n"
  );
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}
function rectStroke(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${C_GRID}" stroke-width="1"/>`;
}
function vline(x: number, y1: number, y2: number): string {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${C_GRID}" stroke-width="1"/>`;
}
function text(
  x: number,
  y: number,
  content: string,
  opts: { size: number; fill: string; weight?: string }
): string {
  const w = opts.weight ? ` font-weight="${opts.weight}"` : "";
  return `<text x="${x}" y="${y}" font-size="${opts.size}"${w} fill="${opts.fill}">${content}</text>`;
}

/**
 * The SVG I/O-table adapter. Validates the document via the SDK (inside
 * buildIoTable), projects it to the standardized table, and renders a
 * self-contained SVG.
 */
export const TableSvgAdapter: Adapter = {
  id: "table-svg",
  label: "ODIO I/O table (SVG)",
  fileExtension: "svg",

  export(device: OdioDevice): AdapterResult {
    const table = buildIoTable(device);
    const svg = renderTableSvg(table);
    const base = table.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "device";
    return { files: [{ path: `${base}.io-table.svg`, content: svg }], warnings: [] };
  }
};
