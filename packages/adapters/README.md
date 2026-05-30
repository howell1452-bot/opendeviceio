# @opendeviceio/adapters

Adapters that convert validated [OpenDeviceIO](https://opendeviceio.org) (`.odio.json`)
documents into design-tool import formats.

Three targets are fully implemented — **EasySchematic**, **AutoCAD DXF**, and
**Microsoft Visio**. **AVCAD** is a registered **stub** behind the same
`Adapter` interface (calling its `export()` throws `NotImplementedError`).

The DXF and Visio targets render a device as a **schematic block: a labeled
rectangle with one labeled I/O terminal per physical connector**. All three
implemented adapters share a single per-connector model (`src/ports.ts`,
`expandConnectors`): each ODIO port is count-expanded into one terminal per
physical connector, typed by a **primary** signal chosen by domain priority
(video > audio > control > network > data > power); the remaining concurrent
flows are summarized in the terminal's notes rather than fanned out. This keeps
the three exporters in agreement about exactly which ports a device exposes.

## What it does

Given a `.odio.json` device, the EasySchematic adapter emits a single JSON file
of the shape EasySchematic's bulk importer expects:

```json
{ "templates": [ { "manufacturer": "...", "modelNumber": "...", "ports": [ ... ] } ] }
```

The adapter accepts a **device**, a **bundle (kit/assembly)**, or a standalone
**cable** document (routed by the document's `kind`):

- **Device** — one `DeviceTemplate`, exactly as before.
- **Bundle/kit** — the kit is flattened via the SDK's `flattenBundle` (recursing
  into nested sub-assemblies, multiplying quantities down the tree). Each leaf
  device becomes one device template; a leaf with effective quantity > 1 is
  expanded into that many disambiguated templates (`label … (n of N)`). Each
  distinct cable becomes a **cable-accessory** template (`isCableAccessory: true`)
  with one bidirectional port per cable **end** — `connectorType` mapped from the
  end connector and `signalType` from the cable's carried signal — and its
  effective quantity recorded on `quantity` (one template per distinct cable, not
  N duplicates). The kit part number is added to every emitted template's
  `searchTerms` for traceability. Unresolved `ref` components are skipped with a
  warning.
- **Cable** — wrapped as a single cable-accessory template.

One `DeviceTemplate` is produced per ODIO device. Ports follow the shared
per-connector model (`expandConnectors`): one EasySchematic port per physical
connector instance (count-expanded), typed by the connector's **primary** signal
(domain priority video > audio > control > network > data > power); the other
concurrent flows are summarized in the port's `notes` (e.g.
`Carries: usb-data, power`) rather than fanned out into extra ports. Connectors
and the primary transport are mapped to EasySchematic's `ConnectorType` /
`SignalType` enums via exhaustive tables; any value outside the known set falls
back to `other` / `custom` and records a warning. Embedded HDMI audio
(LPCM/ARC/eARC riding a video connector) is noted on the video port rather than
emitted as a separate port. Power, thermal (BTU/h), PoE budget/draw, dimensions,
and weight (g→kg) are carried onto the template.

## AutoCAD DXF target (`--target dxf`)

Emits a valid ASCII DXF (AutoCAD R12/2000-compatible) per document. Each device
is defined as a reusable **BLOCK** in the `BLOCKS` section and dropped into model
space with an `INSERT` in `ENTITIES`, so it behaves as a CAD block. Each block
is a titled rectangle (`<manufacturer> <model>`) with, per physical connector, a
short terminal stub `LINE`, a small terminal `CIRCLE` at the edge, and a `TEXT`
label of the form `<port label> (<signalType-or-connector>)`. Inputs sit on the
left edge; outputs and bidirectional ports on the right; rows are distributed
evenly down the body. A minimal `HEADER` and a `TABLES` section with two layers
(`DEVICE`, `PORTS`) are included so the file opens cleanly. The DXF text is
hand-rolled (no dependency). **Bundles** emit one `BLOCK`+`INSERT` per leaf
device (via `flattenBundle`), laid out in a row; cables are listed as `TEXT`
annotations beneath the row (a full wiring diagram is out of scope for a block
library).

## Microsoft Visio target (`--target visio`)

Emits a `.vsdx`, which is an **OPC (zip) package** of XML parts. The adapter
builds a minimal but well-formed package with all required parts
(`[Content_Types].xml`, `_rels/.rels`, `docProps/{core,app}.xml`,
`visio/document.xml`, `visio/_rels/document.xml.rels`,
`visio/pages/pages.xml`, `visio/pages/_rels/pages.xml.rels`,
`visio/pages/page1.xml`, `visio/windows.xml`). Each device is a rectangle
**Shape** titled `<manufacturer> <model>`, with explicit rectangle `Geometry`,
the port labels rendered in the shape text (`<label> (<type>)`), and one
`Connection` point per terminal (inputs on the left edge, others on the right)
so Visio's connector tool can snap wires. **Bundles** place one device shape per
leaf device on the page (laid out in a row); cables are added as text shapes.

The `.vsdx` is **binary** — the adapter returns the zip as `files[0].bytes`
(not `content`), and the CLI writes those bytes verbatim.

> **VSDX real-Visio validation caveat.** This is a hand-built minimal package.
> It targets the documented VSDX (MS-VSDX) schema closely enough to be a valid
> OPC zip containing every required part, with the device rectangle + labeled
> ports in the page XML, but it emits explicit shape `Geometry`/`Text` rather
> than the full Master/stencil machinery a pristine Visio file produces. Like
> the EasySchematic target before it was validated against the real app,
> round-tripping cleanly in the actual Microsoft Visio application still needs
> verification; see the comments in `src/visio.ts`.

## Install

This package is part of the OpenDeviceIO monorepo and depends on
`@opendeviceio/sdk` via a `file:` link. Build the SDK first, then this package:

```bash
# from packages/ts-sdk
npm install && npm run build

# from packages/adapters
npm install
npm run build
npm test
```

## CLI: `odio-export`

```
odio-export <input.odio.json> [--target <id>] [-o <out>]

  --target, -t   adapter id (default: easyschematic):
                 easyschematic | dxf | visio | avcad
  --out,    -o   output file path (default: alongside the input)
```

The input is validated against the ODIO v0.1 schema (via `@opendeviceio/sdk`)
before export; invalid documents exit non-zero with readable errors. Mapping
warnings are printed to stderr.

Example:

```bash
node dist/cli.js ../../examples/lightware-ucx-4x2-hc60d.odio.json \
  --target easyschematic -o ./ucx.easyschematic.json
```

## EasySchematic import workflow

1. Run `odio-export <device>.odio.json --target easyschematic` to produce a
   `{ "templates": [ ... ] }` JSON file.
2. In EasySchematic, use the **bulk device-template import** to load that JSON.
   Each template appears as a reusable device (templates missing a
   `manufacturer`/`modelNumber`, or with `modelNumber === "custom"`, are dropped
   by the importer — this adapter always sets both).
3. Drop the imported device into your schematic; its ports come pre-defined with
   signal types, connectors, sections, and capabilities.

## Programmatic use

```ts
import { parse } from "@opendeviceio/sdk";
import { EasySchematicAdapter, getAdapter } from "@opendeviceio/adapters";

const device = parse(jsonString);
const { files, warnings } = EasySchematicAdapter.export(device);
// files[0].content is the EasySchematic JSON.
```

## Status of targets

| Target        | id              | Status                          |
| ------------- | --------------- | ------------------------------- |
| EasySchematic | `easyschematic` | Implemented                     |
| AutoCAD DXF   | `dxf`           | Implemented (schematic block)   |
| Visio         | `visio`         | Implemented (schematic block) † |
| AVCAD         | `avcad`         | Stub (planned)                  |

† The Visio `.vsdx` is a valid OPC package with the device rectangle + labeled
ports; round-tripping in the real Microsoft Visio app still needs validation
(see the caveat above). AVCAD throws `NotImplementedError`; its planned output
is documented in `src/stubs.ts`.
