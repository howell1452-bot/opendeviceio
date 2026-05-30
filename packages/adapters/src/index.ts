// Public API for @opendeviceio/adapters.

export * from "./types.js";
export {
  CONNECTOR_MAP,
  SIGNAL_MAP,
  mapConnector,
  mapSignalType
} from "./mappings.js";
export { EasySchematicAdapter } from "./easyschematic.js";
export { DxfAdapter } from "./dxf.js";
export { AvcadAdapter } from "./stubs.js";
export { TableSvgAdapter, renderTableSvg } from "./table-svg.js";
export { TableHtmlAdapter, renderTableHtml } from "./table-html.js";
export {
  buildIoTable,
  IO_GROUP_ORDER,
  type IoTable,
  type IoTableRow,
  type IoTableSection,
  type IoTableComponent,
  type IoGroup
} from "./table.js";
export {
  buildBlockModel,
  blockTitle,
  prettifyConnector,
  connectorTypeLabel,
  powerSubtitle,
  type BlockModel,
  type BlockPort
} from "./block.js";
export {
  expandConnectors,
  expandPort,
  PRIMARY_DOMAIN_PRIORITY,
  type ExpandedConnector,
  type PortDirection,
  type SignalView
} from "./ports.js";
export { adapters, adapterIds, getAdapter } from "./registry.js";
