// OpenDeviceIO InDesign panel (UXP).
//
// Fetches a device's standardized I/O table (GET /api/v1/devices/{id}?format=svg),
// writes the SVG to a temp file, and places it onto the active InDesign document —
// so a manufacturer authors the .odio once and drops the same table onto their spec
// sheet. The table is a deterministic projection of the file, so it always matches.
//
// DEVELOPER PREVIEW — targets the InDesign UXP DOM but is not tested in this repo.
// The page.place(...) call is the most likely thing to need adjusting for your
// InDesign version (UXP DOM accepts a UXP file entry / native path).

const { app } = require("indesign");
const fs = require("uxp").storage.localFileSystem;

const $ = (id) => document.getElementById(id);
function status(msg) { $("status").textContent = msg; }
function slug(s) { return (s || "device").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "device"; }

$("place").addEventListener("click", async () => {
  const id = $("id").value.trim();
  const base = ($("base").value.trim() || "https://opendeviceio.org").replace(/\/+$/, "");
  if (!id) { status("Enter a device id."); return; }
  if (!app.documents.length) { status("Open an InDesign document first."); return; }

  $("place").disabled = true;
  try {
    status("Fetching I/O table…");
    const res = await fetch(`${base}/api/v1/devices/${encodeURIComponent(id)}?format=svg`);
    if (!res.ok) { status(`API error ${res.status} for "${id}".`); return; }
    const svg = await res.text();

    const tmp = await fs.getTemporaryFolder();
    const file = await tmp.createFile(`${slug(id)}.io-table.svg`, { overwrite: true });
    await file.write(svg);

    const doc = app.activeDocument;
    const page = doc.layoutWindows.item(0).activePage;
    // Place the SVG; the placed graphic lands on the page (loaded into the cursor in
    // some versions). page.place returns the placed item(s).
    const placed = page.place(file);
    try {
      // Best-effort: position near the top-left margin if we got a graphic frame.
      const item = Array.isArray(placed) ? placed[0] : placed;
      if (item && item.parent) item.geometricBounds = item.geometricBounds; // no-op anchor; layout-specific
    } catch { /* positioning is layout-specific */ }

    status(`Placed I/O table for "${id}".`);
  } catch (e) {
    status("Error: " + (e && e.message ? e.message : String(e)));
  } finally {
    $("place").disabled = false;
  }
});
