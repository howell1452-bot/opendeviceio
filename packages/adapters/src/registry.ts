// Adapter registry: id -> Adapter.

import type { Adapter } from "./types.js";
import { EasySchematicAdapter } from "./easyschematic.js";
import { DxfAdapter } from "./dxf.js";
import { AvcadAdapter } from "./stubs.js";
import { TableSvgAdapter } from "./table-svg.js";

// NOTE: the Visio .vssx file adapter was retired — hand-authored stencils proved
// unreliable to render (Error 313). Visio support moves to a native add-in that
// draws via the Visio API. DXF remains the file-based CAD interchange.

/** All registered adapters keyed by their stable id. */
export const adapters: Readonly<Record<string, Adapter>> = {
  easyschematic: EasySchematicAdapter,
  dxf: DxfAdapter,
  avcad: AvcadAdapter,
  "table-svg": TableSvgAdapter
};

/** The set of valid adapter ids. */
export const adapterIds = Object.keys(adapters);

/** Look up an adapter by id, or undefined if not registered. */
export function getAdapter(id: string): Adapter | undefined {
  return adapters[id];
}
