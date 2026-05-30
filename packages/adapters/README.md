# @opendeviceio/adapters

Adapters that convert validated [OpenDeviceIO](https://opendeviceio.org) (`.odio.json`)
documents into design-tool import formats.

The first and only fully-implemented target is **EasySchematic**. AutoCAD-DXF,
Microsoft Visio, and AVCAD are registered **stubs** behind the same `Adapter`
interface — calling their `export()` throws `NotImplementedError` with a
description of the intended output.

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

One `DeviceTemplate` is produced per ODIO device. For every ODIO port the
adapter emits one EasySchematic port per carried signal (so a single network
connector carrying Dante + AES67 + control becomes three EasySchematic ports),
replicating across `port.count`. Connectors and per-signal transports are mapped
to EasySchematic's `ConnectorType` / `SignalType` enums via exhaustive tables;
any value outside the known set falls back to `other` / `custom` and records a
warning. Embedded HDMI audio (LPCM/ARC/eARC riding a video connector) is noted on
the video port rather than emitted as a separate port. Power, thermal (BTU/h),
PoE budget/draw, dimensions, and weight (g→kg) are carried onto the template.

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

| Target        | id              | Status            |
| ------------- | --------------- | ----------------- |
| EasySchematic | `easyschematic` | Implemented       |
| AutoCAD DXF   | `dxf`           | Stub (planned)    |
| Visio         | `visio`         | Stub (planned)    |
| AVCAD         | `avcad`         | Stub (planned)    |

DXF/Visio/AVCAD throw `NotImplementedError`; their planned output is documented
in `src/stubs.ts`.
