// Shared AVCAD-style schematic-block model used by the DXF and Visio adapters.
//
// Both adapters render a device as a titled block with a header band (manufacturer
// + model + a power summary line) and two columns of I/O rows — inputs on the
// left edge, outputs/bidirectional on the right — where each row carries a two-line
// label: the port name on top and the physical connector type beneath (e.g.
// "HDMI IN 1" / "HDMI", mirroring an AVCAD block's "IN 1" / "2 RCA"). This module
// computes that abstract model once (which ports go on which side, their labels,
// the connector type line, and the power subtitle) so DXF and Visio agree on
// content and only differ in how they draw it.

import { expandConnectors, type ExpandedConnector, type PortDirection } from "./ports.js";

/** One rendered I/O row: a name line + a connector-type line + its side. */
export interface BlockPort {
  /** Primary label line, e.g. "HDMI IN 1". */
  name: string;
  /** Connector/type line, e.g. "HDMI", "RJ45", "3.5 mm". */
  type: string;
  /** Side of the block this row sits on. */
  direction: PortDirection;
}

/** The abstract block: a title, optional power subtitle, and two port columns. */
export interface BlockModel {
  /** "<manufacturer> <model>", e.g. "Crestron UC-ENGINE". */
  title: string;
  /** Power summary, e.g. "24 VDC · 0.83 A" or "100-240 VAC 50/60 Hz". */
  subtitle?: string;
  /** Input rows (left edge). */
  left: BlockPort[];
  /** Output + bidirectional rows (right edge). */
  right: BlockPort[];
}

/** Identity fields the block model reads. */
interface BlockDeviceIdentity {
  manufacturer?: string;
  model?: string;
}

/** A power input as described by the ODIO device schema (loose view). */
interface PowerInputView {
  type?: string;
  voltageRange?: string;
  nominalVoltage?: number;
  frequencyHz?: string;
  standard?: string;
}

/** Device-level power as described by the ODIO device schema (loose view). */
interface PowerView {
  inputs?: PowerInputView[];
  consumptionWatts?: { typical?: number; max?: number };
}

/** The device view the block model reads: identity + ports + optional power. */
export interface BlockDeviceView {
  device: BlockDeviceIdentity;
  ports: Parameters<typeof expandConnectors>[0]["ports"];
  power?: PowerView;
}

/** "<manufacturer> <model>" trimmed, falling back to "Device". */
export function blockTitle(d: BlockDeviceIdentity): string {
  const t = `${d.manufacturer ?? ""} ${d.model ?? ""}`.trim();
  return t.length > 0 ? t : "Device";
}

// Pretty names for the common physical connectors, so the type line reads like a
// CAD block ("HDMI", "RJ45", "XLR-3") rather than a raw vocabulary slug.
const CONNECTOR_PRETTY: Record<string, string> = {
  "hdmi": "HDMI",
  "hdmi-type-a": "HDMI",
  "hdmi-type-c": "Mini-HDMI",
  "hdmi-type-d": "Micro-HDMI",
  "displayport": "DisplayPort",
  "mini-displayport": "Mini-DP",
  "usb-c": "USB-C",
  "usb-type-c": "USB-C",
  "usb-a": "USB-A",
  "usb-type-a": "USB-A",
  "usb-b": "USB-B",
  "usb-type-b": "USB-B",
  "usb-micro-b": "Micro-USB",
  "usb-mini-b": "Mini-USB",
  "rj45": "RJ45",
  "ethercon": "etherCON",
  "rj11": "RJ11",
  "bnc": "BNC",
  "bnc-sdi": "BNC (SDI)",
  "sdi": "BNC (SDI)",
  "rca": "RCA",
  "xlr-3": "XLR-3",
  "xlr-3-male": "XLR-3 (M)",
  "xlr-3-female": "XLR-3 (F)",
  "xlr-5": "XLR-5",
  "trs": "TRS",
  "trs-3.5mm": "3.5 mm",
  "3.5mm": "3.5 mm",
  "minijack": "3.5 mm",
  "phoenix-2": "Phoenix 2",
  "phoenix-3": "Phoenix 3",
  "phoenix-4": "Phoenix 4",
  "phoenix-5": "Phoenix 5",
  "phoenix-6": "Phoenix 6",
  "terminal-block": "Terminal",
  "captive-screw": "Captive screw",
  "iec-c14": "IEC C14",
  "iec-c20": "IEC C20",
  "barrel-dc": "DC barrel",
  "dc-barrel": "DC barrel",
  "fiber-lc": "LC fiber",
  "fiber-sc": "SC fiber",
  "lc": "LC fiber",
  "st": "ST fiber",
  "vga": "VGA",
  "db9": "DB9",
  "db15": "DB15",
  "speakon": "speakON",
  "euroblock": "Euroblock"
};

/** Humanise an unmapped connector slug (uppercase short tokens, spaces for dashes). */
function humanizeConnector(slug: string): string {
  return slug
    .split("-")
    .map((part) =>
      part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

/** The connector-type line for a terminal: physical jack first, then signal. */
export function connectorTypeLabel(t: ExpandedConnector): string {
  if (t.connector === "other") {
    return t.connectorOther ?? t.primaryTransport ?? t.primaryDomain ?? "other";
  }
  return CONNECTOR_PRETTY[t.connector] ?? humanizeConnector(t.connector);
}

/** Format a single power input as a compact descriptor. */
function powerInputLabel(input: PowerInputView): string | undefined {
  switch (input.type) {
    case "dc": {
      if (typeof input.nominalVoltage === "number") return `${input.nominalVoltage} VDC`;
      if (input.voltageRange) return `${input.voltageRange} DC`;
      return "DC";
    }
    case "ac": {
      const v = input.voltageRange ?? (input.nominalVoltage ? `${input.nominalVoltage}V` : "");
      const f = input.frequencyHz ? ` ${input.frequencyHz} Hz` : "";
      return `${v ? `${v} ` : ""}VAC${f}`.replace(/\s+/g, " ").trim();
    }
    case "poe":
      return input.standard ? `PoE (${input.standard})` : "PoE";
    case "usb-pd":
      return "USB-PD";
    default:
      return input.type ? input.type.toUpperCase() : undefined;
  }
}

/** Build the power subtitle line (e.g. "24 VDC · 30 W max") or undefined. */
export function powerSubtitle(power?: PowerView): string | undefined {
  if (!power) return undefined;
  const parts: string[] = [];
  for (const input of power.inputs ?? []) {
    const label = powerInputLabel(input);
    if (label && !parts.includes(label)) parts.push(label);
  }
  const watts = power.consumptionWatts?.max ?? power.consumptionWatts?.typical;
  if (typeof watts === "number" && watts > 0) {
    const suffix = power.consumptionWatts?.max ? " max" : "";
    parts.push(`${watts} W${suffix}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Build the abstract {@link BlockModel} for a device: title + power subtitle and
 * the per-connector rows split into the left (input) and right (output +
 * bidirectional) columns, each row carrying a name line and a connector-type line.
 */
export function buildBlockModel(view: BlockDeviceView): BlockModel {
  const left: BlockPort[] = [];
  const right: BlockPort[] = [];
  for (const t of expandConnectors(view)) {
    const port: BlockPort = {
      name: t.label,
      type: connectorTypeLabel(t),
      direction: t.direction
    };
    if (t.direction === "input") left.push(port);
    else right.push(port);
  }
  return {
    title: blockTitle(view.device),
    subtitle: powerSubtitle(view.power),
    left,
    right
  };
}
