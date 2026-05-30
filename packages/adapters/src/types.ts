// Public type definitions for @opendeviceio/adapters.
//
// These describe (a) the EasySchematic bulk-import document model and (b) the
// generic Adapter contract that every target (EasySchematic + the DXF/Visio/
// AVCAD stubs) implements.

import type { OdioDevice } from "@opendeviceio/sdk";

/**
 * EasySchematic SignalType enum. These literals mirror EasySchematic's own
 * SignalType union exactly; the importer rejects values outside this set.
 */
export type EsSignalType =
  | "sdi"
  | "hdmi"
  | "ndi"
  | "dante"
  | "avb"
  | "analog-audio"
  | "speaker-level"
  | "bluetooth"
  | "aes"
  | "dmx"
  | "madi"
  | "usb"
  | "ethernet"
  | "fiber"
  | "displayport"
  | "hdbaset"
  | "srt"
  | "genlock"
  | "gpio"
  | "contact-closure"
  | "rs422"
  | "serial"
  | "thunderbolt"
  | "composite"
  | "s-video"
  | "vga"
  | "dvi"
  | "power"
  | "power-l1"
  | "power-l2"
  | "power-l3"
  | "power-neutral"
  | "power-ground"
  | "midi"
  | "tally"
  | "spdif"
  | "adat"
  | "ultranet"
  | "aes50"
  | "stageconnect"
  | "wordclock"
  | "aes67"
  | "ydif"
  | "rf"
  | "st2110"
  | "artnet"
  | "sacn"
  | "ir"
  | "timecode"
  | "gigaace"
  | "dx5"
  | "slink"
  | "soundgrid"
  | "fibreace"
  | "dsnake"
  | "dxlink"
  | "gps"
  | "dars"
  | "rtmp"
  | "rtsp"
  | "mpeg-ts"
  | "component-video"
  | "digilink"
  | "ebus"
  | "control-voltage"
  | "extron-exp"
  | "pots"
  | "blu-link"
  | "cresnet"
  | "sensor"
  | "custom";

/**
 * EasySchematic ConnectorType enum. Mirrors EasySchematic's ConnectorType
 * union exactly.
 */
export type EsConnectorType =
  | "bnc"
  | "hdmi"
  | "displayport"
  | "vga"
  | "xlr-3"
  | "xlr-4"
  | "xlr-5"
  | "trs-quarter"
  | "trs-eighth"
  | "combo-xlr-trs"
  | "rj45"
  | "ethercon"
  | "sfp"
  | "lc"
  | "sc"
  | "usb-a"
  | "usb-b"
  | "usb-c"
  | "db7w2"
  | "db9"
  | "db15"
  | "db25"
  | "din-5"
  | "phoenix"
  | "terminal-block"
  | "powercon"
  | "edison"
  | "iec"
  | "iec-c5"
  | "iec-c7"
  | "iec-c15"
  | "iec-c20"
  | "speakon"
  | "socapex"
  | "multipin"
  | "rca"
  | "toslink"
  | "barrel"
  | "banana"
  | "binding-post"
  | "binding-post-banana"
  | "dvi"
  | "mini-xlr"
  | "opticalcon"
  | "l5-20"
  | "l6-20"
  | "l6-30"
  | "l21-30"
  | "cam-lok"
  | "powercon-true1"
  | "qsfp"
  | "qsfp28"
  | "mpo"
  | "digilink"
  | "pcie-6pin"
  | "mini-din-4"
  | "mini-din-7"
  | "mini-din-8"
  | "mini-hdmi"
  | "mini-displayport"
  | "rj11"
  | "rj12"
  | "usb-mini"
  | "usb-micro"
  | "trs-2.5mm"
  | "reverse-tnc"
  | "sma"
  | "db37"
  | "d-tap"
  | "v-mount"
  | "f-connector"
  | "lemo-2pin"
  | "lemo-4pin"
  | "lemo-5pin"
  | "wireless"
  | "solder-cup"
  | "punch-down-110"
  | "punch-down-66"
  | "krone-idc"
  | "d-hole-insert"
  | "none"
  | "other";

/** Port direction as understood by EasySchematic. */
export type EsDirection = "input" | "output" | "bidirectional" | "passthrough";

/** Optional per-port capability block (video-oriented). */
export interface EsPortCapabilities {
  maxResolution?: string;
  maxFrameRate?: number;
  maxBitDepth?: number;
  colorSpaces?: string[];
}

/** A single EasySchematic port on a device template. */
export interface EsPort {
  /** Unique within the template. */
  id: string;
  label: string;
  signalType: EsSignalType;
  direction: EsDirection;
  connectorType: EsConnectorType;
  /** Gender intentionally omitted so EasySchematic derives it. */
  section?: string;
  capabilities?: EsPortCapabilities;
  channelCount?: number;
  poeDrawW?: number;
  linkSpeed?: string;
  notes?: string;
}

/** A single EasySchematic device template (one per ODIO device). */
export interface EsDeviceTemplate {
  label: string;
  deviceType?: string;
  category?: string;
  /** REQUIRED by EasySchematic's importer. */
  manufacturer: string;
  /** REQUIRED by EasySchematic's importer. */
  modelNumber: string;
  model?: string;
  referenceUrl?: string;
  ports: EsPort[];
  powerDrawW?: number;
  powerCapacityW?: number;
  voltage?: string;
  thermalBtuh?: number;
  poeBudgetW?: number;
  poeDrawW?: number;
  heightMm?: number;
  widthMm?: number;
  depthMm?: number;
  weightKg?: number;
  searchTerms?: string[];
}

/** The top-level EasySchematic bulk-import document. */
export interface EsBulkImport {
  templates: EsDeviceTemplate[];
}

/** A single output artifact produced by an adapter. */
export interface AdapterFile {
  /** Suggested relative file path (caller decides where to write). */
  path: string;
  /** File contents. */
  content: string;
}

/** The result of running an adapter over one device. */
export interface AdapterResult {
  files: AdapterFile[];
  /** Non-fatal mapping notes (unmapped connectors/transports, fallbacks, etc.). */
  warnings: string[];
}

/** Common contract every export target implements. */
export interface Adapter {
  /** Stable id used by the registry/CLI, e.g. "easyschematic". */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Default file extension for this target's primary artifact (no dot), e.g. "json". */
  fileExtension: string;
  /**
   * Convert a validated ODIO device into the target format.
   * Implementations MUST validate the input (via the SDK) and throw on invalid
   * documents.
   */
  export(device: OdioDevice, opts?: Record<string, unknown>): AdapterResult;
}

/** Thrown by stub adapters whose target is not yet implemented. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
