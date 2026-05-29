// Public API for @opendeviceio/sdk.

export * from "./types.js";

// The generated root document interface is `OpenDeviceIODevice` (from the
// schema title). Re-export it under the friendlier alias `OdioDevice` for the
// full document, while the generated `Device` remains the identity sub-object.
export type { OpenDeviceIODevice as OdioDevice } from "./types.js";

export {
  validate,
  parse,
  formatErrors,
  OdioValidationError,
  deviceSchema,
  type ValidationError,
  type ValidationResult
} from "./validate.js";

export {
  inputPorts,
  outputPorts,
  portsByConnector,
  portConnectorCount,
  allSignals,
  signalsByDomain,
  signalsByTransport,
  portSignalDomains,
  portSignalTransports,
  totalTypicalWatts,
  totalMaxWatts,
  estimatedBtuPerHour,
  poeBudget,
  rackUnits,
  type SignalDomain,
  type Direction
} from "./accessors.js";
