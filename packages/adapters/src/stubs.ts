// Registered-but-unimplemented export targets. Each implements the Adapter
// contract and throws NotImplementedError from export(), with a message and
// JSDoc describing the intended output. The EasySchematic adapter is the only
// fully-implemented target in this package.

import { NotImplementedError, type Adapter, type AdapterResult } from "./types.js";
import type { OdioDevice } from "@opendeviceio/sdk";

/**
 * AutoCAD DXF adapter (STUB).
 *
 * Planned output: a `.dxf` drawing containing one BLOCK definition per ODIO
 * device. The block would render the device face as a rectangle scaled from
 * `physical.dimensionsMm`, with each ODIO port emitted as a labelled INSERT /
 * attribute (TEXT + connector glyph) positioned via `port.location`. Ports
 * would carry XDATA / EXTENDED ENTITY DATA encoding signalType, direction, and
 * connector so downstream AutoCAD AV libraries can wire connections. One DXF
 * file per device (or a combined block library).
 */
export const DxfAdapter: Adapter = {
  id: "dxf",
  label: "AutoCAD DXF (stub)",
  fileExtension: "dxf",
  export(_device: OdioDevice): AdapterResult {
    throw new NotImplementedError(
      "DXF adapter is not implemented yet. Planned output: a .dxf with one BLOCK per device " +
        "(face rectangle scaled from physical.dimensionsMm) and one labelled port INSERT per ODIO " +
        "port, carrying signal/connector metadata as XDATA."
    );
  }
};

/**
 * Microsoft Visio adapter (STUB).
 *
 * Planned output: either a Visio `.vsdx` master shape per device (a stencil
 * page with the device rectangle and connection points per port) or, as a
 * simpler interchange, a Visio-importable `.csv` shape-data table (one row per
 * port: device, port label, signalType, direction, connector, section). The
 * VSDX path would place named Connection Points so Visio's connector tool can
 * snap wires to ports.
 */
export const VisioAdapter: Adapter = {
  id: "visio",
  label: "Microsoft Visio (stub)",
  fileExtension: "vsdx",
  export(_device: OdioDevice): AdapterResult {
    throw new NotImplementedError(
      "Visio adapter is not implemented yet. Planned output: a Visio master shape per device as " +
        ".vsdx (device rectangle with one connection point per port), or a Visio-importable .csv " +
        "shape-data table (one row per port)."
    );
  }
};

/**
 * AVCAD adapter (STUB).
 *
 * Planned output: an AVCAD device-library `.csv` (one row per device, columns
 * for manufacturer, model, category, physical dimensions, power, and a packed
 * port list) suitable for import into AVCAD's device library so the device can
 * be dropped into AVCAD AV system designs with its ports pre-defined.
 */
export const AvcadAdapter: Adapter = {
  id: "avcad",
  label: "AVCAD (stub)",
  fileExtension: "csv",
  export(_device: OdioDevice): AdapterResult {
    throw new NotImplementedError(
      "AVCAD adapter is not implemented yet. Planned output: an AVCAD device-library .csv " +
        "(one row per device with manufacturer/model/category/dimensions/power and a packed port " +
        "list) for import into AVCAD's device library."
    );
  }
};
