// Exhaustive, explicit mapping tables from the ODIO vocabularies to the
// EasySchematic enums, with fallback helpers that record a warning whenever an
// input falls outside the known set.

import type { Connector } from "@opendeviceio/sdk";
import type { EsConnectorType, EsSignalType } from "./types.js";

/**
 * ODIO connector (physical jack) -> EasySchematic ConnectorType.
 * Every value in the ODIO `connector` enum has an explicit entry. Unknown
 * connectors (or 'other') fall back to 'other' with a warning via
 * {@link mapConnector}.
 */
export const CONNECTOR_MAP: Readonly<Record<Connector, EsConnectorType>> = {
  "hdmi-type-a": "hdmi",
  "hdmi-type-b": "hdmi",
  "hdmi-type-c": "mini-hdmi",
  "hdmi-type-d": "mini-hdmi",
  displayport: "displayport",
  "mini-displayport": "mini-displayport",
  "dvi-d": "dvi",
  "dvi-i": "dvi",
  "dvi-a": "dvi",
  "hd15-vga": "vga",
  "usb-a": "usb-a",
  "usb-b": "usb-b",
  "usb-b-mini": "usb-mini",
  "usb-b-micro": "usb-micro",
  "usb-c": "usb-c",
  rj45: "rj45",
  "rj45-shielded": "rj45",
  ethercon: "ethercon",
  sfp: "sfp",
  "sfp+": "sfp",
  sfp28: "sfp",
  qsfp: "qsfp",
  "qsfp+": "qsfp",
  qsfp28: "qsfp28",
  "fiber-lc": "lc",
  "fiber-lc-duplex": "lc",
  "fiber-sc": "sc",
  "fiber-st": "other",
  "fiber-mpo": "mpo",
  "fiber-mtp": "mpo",
  opticalcon: "opticalcon",
  bnc: "bnc",
  "bnc-din-1.0-2.3": "bnc",
  rca: "rca",
  "f-type": "f-connector",
  toslink: "toslink",
  "mini-toslink": "toslink",
  "xlr-3-m": "xlr-3",
  "xlr-3-f": "xlr-3",
  "xlr-5-m": "xlr-5",
  "xlr-5-f": "xlr-5",
  "mini-xlr-3": "mini-xlr",
  "mini-xlr-4": "mini-xlr",
  "xlr-combo": "combo-xlr-trs",
  "euroblock-3.5mm": "phoenix",
  "euroblock-5.08mm": "phoenix",
  phoenix: "phoenix",
  "terminal-block": "terminal-block",
  "captive-screw": "terminal-block",
  "trs-3.5mm": "trs-eighth",
  "trrs-3.5mm": "trs-eighth",
  "ts-6.35mm": "trs-quarter",
  "trs-6.35mm": "trs-quarter",
  "speakon-nl2": "speakon",
  "speakon-nl4": "speakon",
  "speakon-nl8": "speakon",
  "binding-post": "binding-post",
  banana: "banana",
  db9: "db9",
  db15: "db15",
  db25: "db25",
  rj11: "rj11",
  rj12: "rj12",
  sma: "sma",
  "rp-sma": "sma",
  tnc: "reverse-tnc",
  "n-type": "other",
  "iec-c8": "iec-c7",
  "iec-c14": "iec",
  "iec-c16": "iec",
  "iec-c20": "iec-c20",
  powercon: "powercon",
  "powercon-true1": "powercon-true1",
  "nema-5-15": "edison",
  "barrel-dc": "barrel",
  "phoenix-power": "phoenix",
  other: "other"
};

/**
 * ODIO (domain, transport) -> EasySchematic SignalType, keyed by
 * "<domain>:<transport>". Absent/unmapped transports fall back per-domain via
 * {@link mapSignalType}.
 */
export const SIGNAL_MAP: Readonly<Record<string, EsSignalType>> = {
  // video
  "video:hdmi": "hdmi",
  "video:displayport": "displayport",
  "video:dvi": "dvi",
  "video:vga": "vga",
  "video:component": "component-video",
  "video:composite": "composite",
  "video:s-video": "s-video",
  "video:sdi-3g": "sdi",
  "video:sdi-6g": "sdi",
  "video:sdi-12g": "sdi",
  "video:hdbaset": "hdbaset",
  "video:sdvoe": "st2110",
  "video:ndi": "ndi",
  "video:ndi-hx": "ndi",
  "video:ipmx": "st2110",
  "video:dante-av": "ndi",
  "video:av-over-ip": "st2110",
  "video:usb-uvc": "usb",
  "video:h.264": "custom",
  "video:h.265": "custom",
  "video:mjpeg": "custom",

  // audio
  "audio:analog": "analog-audio",
  "audio:lpcm": "custom",
  "audio:aes3": "aes",
  "audio:spdif": "spdif",
  "audio:adat": "adat",
  "audio:madi": "madi",
  "audio:arc": "hdmi",
  "audio:earc": "hdmi",
  "audio:dante": "dante",
  "audio:aes67": "aes67",
  "audio:avb": "avb",
  "audio:milan": "avb",
  "audio:cobranet": "custom",
  "audio:livewire": "custom",
  "audio:usb-uac": "usb",
  "audio:bluetooth": "bluetooth",

  // control
  "control:rs-232": "serial",
  "control:rs-422": "rs422",
  "control:rs-485": "serial",
  "control:ir": "ir",
  "control:cec": "custom",
  "control:gpio": "gpio",
  "control:contact-closure": "contact-closure",
  "control:relay": "contact-closure",
  "control:usb-hid": "usb",
  "control:usb-cdc": "usb",
  "control:cresnet": "cresnet",
  "control:knx": "custom",
  "control:dali": "custom",
  "control:dmx512": "dmx",
  "control:artnet": "artnet",
  "control:sacn": "sacn",
  "control:onvif": "ethernet",
  "control:sip": "ethernet",
  "control:bacnet": "custom",
  "control:modbus": "serial",
  "control:mqtt": "ethernet",
  "control:http": "ethernet",
  "control:rest": "ethernet",
  "control:telnet": "ethernet",
  "control:ssh": "ethernet",
  "control:ip-control": "ethernet",

  // network
  "network:ethernet": "ethernet",
  "network:ip": "ethernet",
  "network:control-network": "ethernet",
  "network:av-network": "ethernet",
  "network:management": "ethernet",
  "network:vlan-trunk": "ethernet",

  // data
  "data:usb-data": "usb",
  "data:usb-mass-storage": "usb",
  "data:thunderbolt": "thunderbolt",
  "data:file-transfer": "ethernet",

  // power
  "power:ac": "power",
  "power:dc": "power",
  "power:usb-pd": "power",
  "power:poe": "power",
  "power:phantom": "power",
  "power:trigger": "control-voltage",
  "power:wireless-power": "power"
};

/** Per-domain fallback SignalType when a transport is absent or unmapped. */
const SIGNAL_DOMAIN_FALLBACK: Readonly<Record<string, EsSignalType>> = {
  video: "custom",
  audio: "custom",
  control: "custom",
  network: "ethernet",
  data: "usb",
  power: "power"
};

/**
 * Map an ODIO connector to an EasySchematic ConnectorType. Records a warning
 * for 'other' or any value not present in {@link CONNECTOR_MAP}.
 */
export function mapConnector(
  connector: string,
  connectorOther: string | undefined,
  warnings: string[],
  portId: string
): EsConnectorType {
  const mapped = CONNECTOR_MAP[connector as Connector];
  if (mapped === undefined) {
    warnings.push(
      `Port "${portId}": unknown connector "${connector}" mapped to "other".`
    );
    return "other";
  }
  if (connector === "other") {
    const detail = connectorOther ? ` ("${connectorOther}")` : "";
    warnings.push(
      `Port "${portId}": connector "other"${detail} mapped to EasySchematic "other".`
    );
  }
  return mapped;
}

/**
 * Map an ODIO (domain, transport) pair to an EasySchematic SignalType. Records
 * a warning when the transport is absent or has no explicit mapping, falling
 * back per-domain.
 */
export function mapSignalType(
  domain: string,
  transport: string | undefined,
  warnings: string[],
  portId: string
): EsSignalType {
  if (transport !== undefined) {
    const mapped = SIGNAL_MAP[`${domain}:${transport}`];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  const fallback = SIGNAL_DOMAIN_FALLBACK[domain] ?? "custom";
  const what = transport ? `transport "${transport}"` : "absent transport";
  warnings.push(
    `Port "${portId}": ${domain} ${what} has no explicit mapping; using "${fallback}".`
  );
  return fallback;
}
