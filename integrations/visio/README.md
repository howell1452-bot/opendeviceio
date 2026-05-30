# OpenDeviceIO → Microsoft Visio importer

Draws an ODIO device's schematic block onto the active Visio page by fetching its
**DrawProgram** from the OpenDeviceIO API (`?format=draw`) and drawing live shapes via
the Visio COM API — **no `.vssx` stencil files** (which proved unreliable to render).
Same draw-instruction contract as the AutoCAD add-in; layout is computed server-side.

> Status: developer preview. Builds against the Visio interop assembly but is not
> compiled/tested in this repo. Visio COM cell names/units are the likely tweak points.

## Install (end users)

Download **`OdioToVisio.msi`** from the GitHub Release and run it — it installs the tool
per-user and adds a Start-menu shortcut (**OpenDeviceIO Visio Importer**). With a Visio
document open, launch it, enter a device id when prompted, and the block is drawn on the
active page.

> An **in-ribbon VSTO/COM add-in** (a button inside Visio) is the polished UX, but it
> requires the Office/VSTO developer toolchain to build — not buildable from plain CI.
> The installable tool above is the shippable form today; the ribbon add-in is tracked in
> [`../RELEASING.md`](../RELEASING.md).

## Build

```
dotnet build OdioToVisio.csproj -c Release
```

The Visio interop assembly comes from the `Microsoft.Office.Interop.Visio` NuGet, so it
builds without Visio installed. Visio is required at run time. (CI also packages an MSI;
see `installer/OdioToVisio.wxs`.)

## Use (from a build)

Open Visio (with a drawing/page active), then run:

```
OdioToVisio crestron/dm-nvx-360       # or run with no arg and it prompts for the id
```

It attaches to the running Visio (or launches one), fetches the device, and draws the
block on the active page (1 mm → 1/25.4 in). Bundles draw one block per device in a row
with cables listed beneath; modular-chassis cards are titled by slot.

Point at another deployment with `ODIO_API_BASE` (default `https://opendeviceio.org`).

## How it works

`GET {ODIO_API_BASE}/api/v1/devices/{id}?format=draw` → `DocumentPrograms`
(`programs[]` of `{ width, height, title, ops[] }`). Each op (`rect | line | circle |
text | connection`, mm / origin bottom-left / Y up) maps to a Visio
`DrawRectangle`/`DrawLine`/`DrawOval`/text shape. Roadmap: group each block's shapes and
add real Visio connection points to the body so wires snap to terminals.
