// Registered-but-unimplemented export targets. The DXF and Visio targets are
// now fully implemented (see src/dxf.ts and src/visio.ts); AVCAD remains a stub.
// It implements the Adapter contract and throws NotImplementedError from
// export(), with a message and JSDoc describing the intended output.

import { NotImplementedError, type Adapter, type AdapterResult } from "./types.js";
import type { OdioDevice } from "@opendeviceio/sdk";

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
