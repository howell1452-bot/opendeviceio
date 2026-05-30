// ODIO I/O-table renderer — self-contained HTML target ("table-html", .html).
//
// This is the `odio pack` artifact (DESIGN.md §14.5): a single HTML file that
// embeds the standardized I/O-table SVG inline plus the source .odio JSON, opens
// in any browser with no app or association, and can be printed to PDF. Nothing is
// fetched at runtime — the file is portable and offline-friendly. The embedded
// <script type="application/odio+json"> block lets a future in-page viewer
// re-render the document from the same file.

import type { OdioDevice } from "@opendeviceio/sdk";
import { ODIO_MEDIA_TYPE, ODIO_VERSION } from "@opendeviceio/sdk";
import type { Adapter, AdapterResult } from "./types.js";
import { renderTableSvg } from "./table-svg.js";
import { buildIoTable } from "./table.js";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Render a complete, self-contained HTML document around the I/O-table SVG. */
export function renderTableHtml(document: OdioDevice): string {
  const table = buildIoTable(document);
  // Inline the SVG (drop its XML declaration so it embeds in HTML cleanly).
  const svg = renderTableSvg(table).replace(/^<\?xml[^>]*\?>\s*/, "");
  const json = JSON.stringify(document, null, 2);
  const title = table.title;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="OpenDeviceIO ${ODIO_VERSION}">
<title>${escHtml(title)} — ODIO I/O table</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, Arial, sans-serif; color: #1f2937; background: #eef1f5; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  header.page { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  header.page h1 { font-size: 18px; margin: 0; }
  header.page .src { font-size: 12px; color: #6b7280; }
  .card { background: #fff; border: 1px solid #d6dae0; border-radius: 10px; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); overflow-x: auto; }
  .card svg { max-width: 100%; height: auto; display: block; }
  .actions { margin: 14px 0; display: flex; gap: 8px; flex-wrap: wrap; }
  .actions button { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1px solid #cbd2da; background: #fff; cursor: pointer; }
  .actions button:hover { border-color: #f2a93b; }
  details { margin-top: 18px; }
  summary { cursor: pointer; font-size: 13px; color: #374151; }
  pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 10px; overflow-x: auto; font-size: 12px; line-height: 1.5; }
  footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
  footer a { color: #b45309; }
  @media print { body { background: #fff; } .actions, footer { display: none; } .card { border: none; box-shadow: none; padding: 0; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="page">
    <h1>${escHtml(title)}</h1>
    <span class="src">OpenDeviceIO I/O table · ${ODIO_VERSION}</span>
  </header>

  <div class="card" id="table">${svg}</div>

  <div class="actions">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button onclick="downloadSvg()">Download SVG</button>
    <button onclick="downloadOdio()">Download .odio</button>
  </div>

  <details>
    <summary>View source (.odio JSON)</summary>
    <pre id="source">${escHtml(json)}</pre>
  </details>

  <footer>
    Generated from an <strong>.odio</strong> file by
    <a href="https://opendeviceio.org">OpenDeviceIO</a>. The I/O table is a deterministic
    projection of the device data — edit the source and regenerate; the table never drifts.
  </footer>
</div>

<script type="application/odio+json" id="odio-data">${json.replace(/<\//g, "<\\/")}</script>
<script>
  function dl(name, text, type) {
    var b = new Blob([text], { type: type });
    var u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(u);
  }
  function downloadSvg() {
    var svg = document.querySelector('#table svg');
    dl(${JSON.stringify(slug(title))} + '.io-table.svg',
       '<?xml version="1.0" encoding="UTF-8"?>\\n' + svg.outerHTML, 'image/svg+xml');
  }
  function downloadOdio() {
    dl(${JSON.stringify(slug(title))} + '.odio',
       document.getElementById('odio-data').textContent, ${JSON.stringify(ODIO_MEDIA_TYPE)});
  }
</script>
</body>
</html>
`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "device";
}

/** The self-contained HTML I/O-table adapter (the `odio pack` artifact). */
export const TableHtmlAdapter: Adapter = {
  id: "table-html",
  label: "ODIO I/O table (self-contained HTML)",
  fileExtension: "html",

  export(device: OdioDevice): AdapterResult {
    const html = renderTableHtml(device);
    const base = slug(buildIoTable(device).title);
    return { files: [{ path: `${base}.io-table.html`, content: html }], warnings: [] };
  }
};
