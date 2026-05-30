# OpenDeviceIO → Microsoft Visio importer

Draws an ODIO device's schematic block onto the active Visio page by fetching its
**DrawProgram** from the OpenDeviceIO API (`?format=draw`) and drawing live shapes via
the Visio COM API — **no `.vssx` stencil files** (which proved unreliable to render).
Same draw-instruction contract as the AutoCAD add-in; layout is computed server-side.

> Status: developer preview. Builds against the Visio interop assembly but has **not**
> been compiled/tested in this repo's environment. Visio COM cell names/units are the
> most likely things to tweak. A proper ribbon add-in can wrap the same draw routine.

## Build

```
dotnet build OdioToVisio.csproj -c Release
```

The Visio interop assembly comes from the `Microsoft.Office.Interop.Visio` NuGet, so it
builds without Visio installed. Visio is required at run time.

## Use

Open Visio (with a drawing/page active), then run:

```
OdioToVisio crestron/dm-nvx-360
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
