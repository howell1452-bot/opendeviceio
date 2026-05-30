// Adapter registry: id -> Adapter.

import type { Adapter } from "./types.js";
import { EasySchematicAdapter } from "./easyschematic.js";
import { DxfAdapter } from "./dxf.js";
import { VisioAdapter } from "./visio.js";
import { AvcadAdapter } from "./stubs.js";
import { TableSvgAdapter } from "./table-svg.js";

/** All registered adapters keyed by their stable id. */
export const adapters: Readonly<Record<string, Adapter>> = {
  easyschematic: EasySchematicAdapter,
  dxf: DxfAdapter,
  visio: VisioAdapter,
  avcad: AvcadAdapter,
  "table-svg": TableSvgAdapter
};

/** The set of valid adapter ids. */
export const adapterIds = Object.keys(adapters);

/** Look up an adapter by id, or undefined if not registered. */
export function getAdapter(id: string): Adapter | undefined {
  return adapters[id];
}
