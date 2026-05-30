# @opendeviceio/adapters

Adapters that convert validated [OpenDeviceIO](https://opendeviceio.org) (`.odio`)
documents into design-tool and presentation formats. Every adapter accepts a
**device**, a **bundle (kit/assembly)**, or a standalone **cable** (routed by the
document's `kind`); bundles are flattened via the SDK's `flattenBundle` (recursing
sub-assemblies, multiplying quantities), including modular-chassis frames + cards.

## Targets

| Target | id | Output |
| --- | --- | --- |
| EasySchematic | `easyschematic` | Device-template JSON for EasySchematic's importer. |
| AutoCAD DXF | `dxf` | A schematic-block DXF (AC1027 / opens in AutoCAD 2018+). |
| I/O table (SVG) | `table-svg` | The standardized I/O table as a vector SVG for spec sheets. |
| I/O table (HTML) | `table-html` | A self-contained HTML page embedding the table + source `.odio`. |
| AVCAD | `avcad` | Registered **stub** (`export()` throws `NotImplementedError`). |

> The Visio `.vssx` target was **removed**: hand-authored stencils proved unreliable
> to render. Visio support moved to a native add-in that draws via the Visio API
> (`integrations/visio`), consuming the DrawProgram below.

## Shared models

- **`ports.ts` / `expandConnectors`** — one terminal per physical connector
  (count-expanded), typed by a **primary** signal (domain priority
  video > audio > control > network > data > power); other concurrent flows are
  summarized rather than fanned out. Every adapter agrees on the ports a device exposes.
- **`block.ts`** — the AVCAD-style block model (title, power subtitle, prettified
  connectors, two-column I/O).
- **`table.ts`** — the standardized **I/O-table** projection (rows grouped Input /
  Output / Bidirectional / Power; columns Label · Dir · Connector · Link · Signals;
  bundles add per-device sections + a components list; chassis cards labelled by slot).
- **`drawops.ts`** — a host-agnostic **DrawProgram** (rect/line/circle/text/connection
  ops in mm, origin bottom-left, Y up). `dxf.ts` renders it, and the native AutoCAD /
  Visio / InDesign integrations consume the same program (via `?format=draw` on the API),
  so every surface draws identical blocks. `buildDeviceProgram` / `buildDevicePrograms`.

## CLI: `odio-export`

```
odio-export <input.odio> [--target <id>] [-o <out>]    (.odio or legacy .odio.json)

  --target, -t   adapter id (default: easyschematic):
                 easyschematic | dxf | table-svg | table-html | avcad
  --es-format    EasySchematic envelope: array | bulk (default: array)
  --out,    -o   output file path (default: alongside the input)
```

The input is validated against the ODIO v0.1 schema before export; invalid documents
exit non-zero with readable errors. Mapping warnings print to stderr.

```bash
node dist/cli.js ../../examples/lightware-ucx-4x2-hc60d.odio.json -t table-svg -o ./ucx.svg
```

## Programmatic use

```ts
import { parse } from "@opendeviceio/sdk";
import { buildIoTable, renderTableSvg, buildDevicePrograms, getAdapter } from "@opendeviceio/adapters";

const device = parse(jsonString);
const svg = renderTableSvg(buildIoTable(device));     // standardized I/O-table SVG
const { programs } = buildDevicePrograms(device);     // host-agnostic draw program(s)
const out = getAdapter("dxf")!.export(device);        // out.files[0].content is the DXF
```

## Install (in the monorepo)

```bash
npm --prefix packages/ts-sdk run build   # build the SDK first
npm --prefix packages/adapters run build
npm --prefix packages/adapters test
```
