# OpenDeviceIO — AutoCAD import add-in

Adds the **`ODIOIMPORT`** command to AutoCAD: enter a device id, and the add-in
pulls that device's schematic block from the OpenDeviceIO API and draws it into the
active drawing as a real block (outline, labeled terminals, title). Block layout is
computed server-side from the `.odio` file (the single source shared with DXF/Visio/
InDesign), so the add-in only translates draw instructions → AutoCAD entities.

> Status: reference scaffold. It targets the AutoCAD .NET API but has **not** been
> compiled/tested in this repo's environment — build it in Visual Studio against your
> AutoCAD and iterate.

## Requirements

- AutoCAD 2018–2024 (Win64).
- .NET Framework 4.8 SDK + Visual Studio 2022 (or `dotnet`/`msbuild`).

## Build

```
dotnet build OdioImport.csproj -c Release
```

The project gets the AutoCAD managed assemblies from the **`AutoCAD.NET`** NuGet
package (reference-only), so it builds without AutoCAD installed. Set the version to
match your release in `OdioImport.csproj`:

| AutoCAD | `AutoCAD.NET` version |
| --- | --- |
| 2018 | 22.0.0 |
| 2019 | 23.0.0 (default) |
| 2020 | 23.1.0 |
| 2021 | 24.0.0 |
| 2022 | 24.1.0 |
| 2023 | 24.2.0 |
| 2024 | 24.3.0 |

A plug-in built against an **older** version loads in newer AutoCAD, so 23.0.0 covers
2019–2024; drop to 22.0.0 if you must support 2018. (Alternatively, reference the DLLs
from your AutoCAD install — see the commented block in `OdioImport.csproj`.)

## Install

**Quick (per session):** `NETLOAD` → pick `OdioImport.dll`.

**Auto-load (recommended):** copy into
`%APPDATA%\Autodesk\ApplicationPlugins\OdioImport.bundle\` as:

```
OdioImport.bundle\
  PackageContents.xml         (from this folder)
  Contents\
    OdioImport.dll            (build output)
    Newtonsoft.Json.dll       (from the build output)
```

AutoCAD registers `ODIOIMPORT` on demand at startup.

## Use

```
Command: ODIOIMPORT
OpenDeviceIO device id (e.g. crestron/dm-md8x8): crestron/dm-nvx-360
Insertion point: <pick>
```

The block is drawn at 1 unit = 1 mm. Bundles/kits draw one block per device in a row,
with cables listed beneath; modular-chassis cards are titled by their slot.

Point the add-in at a different deployment with the `ODIO_API_BASE` environment
variable (default `https://opendeviceio.org`).

## How it works

`GET {ODIO_API_BASE}/api/v1/devices/{id}?format=draw` returns a `DocumentPrograms`
JSON (`programs[]` of `{ width, height, title, ops[] }`, plus `cables[]`). Each op is
`rect | line | circle | text | connection` in millimetres (origin bottom-left, Y up).
`OdioCommands.ToEntity` maps each to a Polyline/Line/Circle/MText; `text` ops use MText
attachment points for justification (native font metrics, so no fitting needed).
