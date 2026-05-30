// Public API for @opendeviceio/sdk.

export * from "./types.js";

// File-format identity: media type + `.odio` / `.odio.json` extension helpers.
export {
  ODIO_MEDIA_TYPE,
  ODIO_EXTENSION,
  ODIO_LEGACY_EXTENSION,
  ODIO_VERSION,
  isOdioPath,
  odioFilename
} from "./media.js";

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

// --- Bundle & cable document types ---------------------------------------
// The generated root interfaces are `OpenDeviceIOBundle` / `OpenDeviceIOCable`;
// re-export under friendlier `Bundle` / `Cable` aliases for the full documents.
// `Cable` (the cable body sub-object) and supporting component types come from
// the bundle types module. We export selected names (not `export *`) to avoid
// clashing with the device `Port`/`Signal`/etc. already re-exported above.
export type {
  OpenDeviceIOBundle as Bundle,
  BundleIdentity,
  Component,
  DeviceComponent,
  BundleComponent,
  CableComponent,
  AccessoryComponent,
  Ref as ComponentRef,
  CableEnd,
  Cable as CableBody
} from "./bundle-types.js";
export type { OpenDeviceIOCable as Cable } from "./cable-types.js";

// --- Bundle & cable validation / parsing ---------------------------------
export {
  validateBundle,
  validateCable,
  validateDocument,
  parseBundle,
  parseCable,
  parseDocument,
  bundleSchema,
  cableSchema,
  type DocumentKind,
  type DocumentValidationResult,
  type OdioDocument
} from "./validate-bundle.js";

// --- Bundle expansion & BOM accessors ------------------------------------
export {
  flattenBundle,
  bundleDeviceCount,
  bundleBillOfMaterials,
  type FlattenedBundle,
  type FlattenedDevice,
  type FlatDeviceEntry,
  type FlatCableEntry,
  type FlatAccessoryEntry,
  type UnresolvedRefEntry,
  type FlattenOptions,
  type ResolvedDocument,
  type BomLine
} from "./bundle.js";
