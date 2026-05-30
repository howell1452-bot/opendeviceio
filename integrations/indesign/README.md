# OpenDeviceIO → Adobe InDesign plugin

A UXP panel that places a device's **standardized I/O table** onto the active InDesign
document — author the `.odio` once, drop the same table onto your spec sheet. It fetches
the table as SVG from the OpenDeviceIO API (`?format=svg`); because the table is a
deterministic projection of the file, the datasheet never drifts from the data.

> Status: developer preview. Targets the InDesign UXP DOM but has **not** been tested in
> this repo's environment. The `page.place(...)` call is the most likely thing to adjust
> for your InDesign version.

## Requirements

- Adobe InDesign 2023 (18.0) or newer (UXP plugins).
- Adobe UXP Developer Tool (UDT) for loading during development.

## Load (development)

1. Open **UXP Developer Tool**.
2. **Add Plugin** → select this folder's `manifest.json`.
3. **Load** → with InDesign open and a document active, the **OpenDeviceIO** panel
   appears under *Window › Plugins*.

For distribution, package as a `.ccx` via UDT (**Package**) and share / submit to Adobe
Exchange.

## Use

1. Open the document you're laying out.
2. In the panel, enter a device id (e.g. `crestron/dm-nvx-360`) and click **Place I/O
   table**. The SVG is placed on the active page; position/scale it like any placed
   graphic.

Point at another deployment by changing **API base** (default `https://opendeviceio.org`;
`http://localhost:3000` is allowed for local dev — see `manifest.json` network domains).

## How it works

`GET {base}/api/v1/devices/{id}?format=svg` returns the standardized I/O-table SVG. The
panel writes it to a temp file (UXP `localFileSystem`) and calls the InDesign DOM
`page.place(file)`. Roadmap: place by dropping an `.odio` file directly, a size/position
control, and a PDF option for print color management.
