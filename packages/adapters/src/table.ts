// The standardized ODIO I/O-table projection (DESIGN.md §14.3).
//
// A deterministic, normative mapping from an ODIO document to a tabular view of
// its I/O: one row per physical connector (count-expanded), grouped Inputs /
// Outputs / Bidirectional / Power, with a fixed set of columns. This is the model
// the table renderers (SVG/HTML/PDF/Markdown) share, so every manufacturer's I/O
// table is structurally identical. The model is pure data; renderers decide pixels.

import {
  validateDocument,
  flattenBundle,
  formatErrors,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice,
  type Port,
  type Signal
} from "@opendeviceio/sdk";

import { blockTitle, powerSubtitle, prettifyConnector } from "./block.js";

/** Section a row belongs to (drives grouping + ordering in the table). */
export type IoGroup = "Input" | "Output" | "Bidirectional" | "Power";

/** Fixed top-to-bottom group order. */
export const IO_GROUP_ORDER: IoGroup[] = ["Input", "Output", "Bidirectional", "Power"];

/** One table row = one physical connector instance (or a power input). */
export interface IoTableRow {
  group: IoGroup;
  /** Short, cell-friendly label (shortLabel ?? label ?? id, + unit number). */
  label: string;
  /** Compact direction token: "In" | "Out" | "Bi" | "Power". */
  dir: string;
  /** Prettified physical connector, e.g. "HDMI", "RJ45", "Phoenix 3". */
  connector: string;
  /** Link summary: standard/speed + PoE/USB-PD/fiber, e.g. "HDBaseT · PoE+". */
  link: string;
  /** Concurrent flows, e.g. "AVoIP, AES67, LAN". */
  signals: string;
  /** Faceplate side, when known ("front"/"rear"/…). */
  face?: string;
  /** Free-text notes carried from the port. */
  notes?: string;
}

/** A table section. Single devices have one (unheaded) section; bundles one per device. */
export interface IoTableSection {
  /** Device title for a bundle leaf; undefined for a standalone device. */
  heading?: string;
  rows: IoTableRow[];
}

/** A bundle bill-of-materials line. */
export interface IoTableComponent {
  label: string;
  quantity: number;
  kind: string;
}

/** The standardized I/O table for a document. */
export interface IoTable {
  title: string;
  subtitle?: string;
  sections: IoTableSection[];
  /** Present for bundles: the kit's components/cables. */
  components?: IoTableComponent[];
}

type SignalView = Signal & {
  domain?: string;
  transport?: string;
  standard?: string;
};
type LinkView = NonNullable<Port["link"]> & Record<string, unknown>;

const DIR_TOKEN: Record<string, string> = {
  input: "In",
  output: "Out",
  bidirectional: "Bi"
};
const DIR_GROUP: Record<string, IoGroup> = {
  input: "Input",
  output: "Output",
  bidirectional: "Bidirectional"
};

const POE_PRETTY: Record<string, string> = {
  "802.3af": "PoE",
  "802.3at": "PoE+",
  "802.3bt-type3": "PoE++ (Type 3)",
  "802.3bt-type4": "PoE++ (Type 4)",
  passive: "Passive PoE",
  other: "PoE"
};

/** Compact summary of a port's physical link (standard/speed + PoE/USB-PD/fiber). */
function linkSummary(link: LinkView | undefined): string {
  if (!link) return "";
  const parts: string[] = [];
  const standard = typeof link.standard === "string" ? link.standard : undefined;
  const type = typeof link.type === "string" ? link.type : undefined;
  if (standard) parts.push(standard.toUpperCase());
  else if (type && type !== "other") parts.push(type.toUpperCase());
  else if (type === "other" && typeof link.typeOther === "string") parts.push(link.typeOther);

  if (typeof link.speed === "string") parts.push(link.speed.toUpperCase());
  else if (typeof link.bandwidthGbps === "number") parts.push(`${link.bandwidthGbps} Gbps`);

  const poe = link.poe as { standard?: string; role?: string; classWatts?: number } | undefined;
  if (poe) {
    let s = poe.standard ? POE_PRETTY[poe.standard] ?? "PoE" : "PoE";
    if (poe.role === "pse") s += " (PSE)";
    if (typeof poe.classWatts === "number") s += ` ${poe.classWatts}W`;
    parts.push(s);
  }
  if (typeof link.powerDeliveryWatts === "number") parts.push(`USB-PD ${link.powerDeliveryWatts}W`);
  if (typeof link.fiberMode === "string") {
    parts.push(link.fiberMode === "single-mode" ? "SMF" : "MMF");
  }
  return parts.join(" · ");
}

/** Distinct concurrent flow descriptors for a port, e.g. "AVoIP, AES67, LAN". */
function signalsSummary(signals: SignalView[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of signals) {
    const d = (s.transport ?? s.domain ?? "").toString();
    if (!d) continue;
    const label = d.length <= 4 ? d.toUpperCase() : d;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out.join(", ");
}

type PortView = Port & {
  shortLabel?: string;
  location?: { face?: string };
  notes?: string;
};

/** Build the connector rows for one device's ports (count-expanded). */
function deviceRows(ports: PortView[]): IoTableRow[] {
  const rows: IoTableRow[] = [];
  for (const port of ports) {
    const count = typeof port.count === "number" && port.count >= 1 ? port.count : 1;
    const baseLabel = port.shortLabel ?? port.label ?? port.id;
    const dir = (port.direction as string) ?? "bidirectional";
    const group = DIR_GROUP[dir] ?? "Bidirectional";
    const connector =
      port.connector === "other"
        ? port.connectorOther ?? "other"
        : prettifyConnector(port.connector as string);
    const link = linkSummary(port.link as LinkView | undefined);
    const signals = signalsSummary((port.signals ?? []) as SignalView[]);
    for (let unit = 1; unit <= count; unit++) {
      rows.push({
        group,
        label: count > 1 ? `${baseLabel} ${unit}` : baseLabel,
        dir: DIR_TOKEN[dir] ?? "Bi",
        connector,
        link,
        signals,
        face: port.location?.face,
        notes: port.notes
      });
    }
  }
  return rows;
}

/** Power-input rows derived from device-level `power.inputs`. */
function powerRows(power: OdioDevice["power"] | undefined): IoTableRow[] {
  const inputs = (power as { inputs?: Record<string, unknown>[] } | undefined)?.inputs ?? [];
  const rows: IoTableRow[] = [];
  for (const inp of inputs) {
    const type = (inp.type as string) ?? "power";
    const connector = typeof inp.connector === "string" ? prettifyConnector(inp.connector) : "—";
    const bits: string[] = [];
    if (typeof inp.nominalVoltage === "number") bits.push(`${inp.nominalVoltage} VDC`);
    if (typeof inp.voltageRange === "string") bits.push(inp.voltageRange);
    if (typeof inp.frequencyHz === "string") bits.push(`${inp.frequencyHz} Hz`);
    if (typeof inp.standard === "string") bits.push(inp.standard);
    rows.push({
      group: "Power",
      label: type.toUpperCase(),
      dir: "Power",
      connector,
      link: bits.join(" · "),
      signals: "power"
    });
  }
  return rows;
}

/** Order a section's rows by the fixed group order, preserving in-group order. */
function sortRows(rows: IoTableRow[]): IoTableRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const g = IO_GROUP_ORDER.indexOf(a.r.group) - IO_GROUP_ORDER.indexOf(b.r.group);
      return g !== 0 ? g : a.i - b.i;
    })
    .map((x) => x.r);
}

interface DeviceLike {
  device?: { manufacturer?: string; model?: string };
  ports?: PortView[];
  power?: OdioDevice["power"];
}

function sectionFor(view: DeviceLike): IoTableSection {
  const rows = sortRows([...deviceRows(view.ports ?? []), ...powerRows(view.power)]);
  return { rows };
}

function cableComponentLabel(cable: CableBody): string {
  const base = `${cable.manufacturer ?? ""} ${cable.model ?? cable.sku ?? cable.label ?? "cable"}`.trim();
  return base || "cable";
}

/**
 * Build the standardized {@link IoTable} for a validated ODIO document. Devices
 * yield one section; bundles yield one section per leaf device plus a components
 * list; a standalone cable yields a single component row.
 */
export function buildIoTable(document: OdioDevice): IoTable {
  const routed = validateDocument(document);
  if (!routed.valid) {
    throw new Error(
      `I/O table: input is not a valid OpenDeviceIO ${routed.kind} document:\n${formatErrors(
        routed.errors
      )}`
    );
  }

  if (routed.kind === "bundle") {
    const bundle = document as unknown as Bundle;
    const flat = flattenBundle(bundle);
    const sections: IoTableSection[] = [];
    const components: IoTableComponent[] = [];
    for (const entry of flat.devices) {
      const v = entry.device as FlattenedDevice;
      const title = blockTitle(v.device ?? {});
      // Prefix modular-chassis cards with their slot; mark a frame as such.
      const heading = entry.slot
        ? `Slot ${entry.slot} · ${title}`
        : (v as { slots?: unknown[] }).slots?.length
          ? `${title} (frame)`
          : title;
      const sec = sectionFor({ device: v.device, ports: v.ports as PortView[], power: v.power });
      sec.heading = heading;
      sections.push(sec);
      components.push({ label: heading, quantity: entry.quantity, kind: "device" });
    }
    for (const entry of flat.cables) {
      components.push({
        label: cableComponentLabel(entry.cable as CableBody),
        quantity: entry.quantity,
        kind: "cable"
      });
    }
    return {
      title: blockTitle(bundle.bundle ?? {}),
      subtitle: undefined,
      sections,
      components
    };
  }

  if (routed.kind === "cable") {
    const cable = (document as unknown as { cable: CableBody }).cable;
    return {
      title: cableComponentLabel(cable),
      sections: [{ rows: [] }],
      components: [{ label: cableComponentLabel(cable), quantity: 1, kind: "cable" }]
    };
  }

  const dev = document as unknown as DeviceLike;
  return {
    title: blockTitle(dev.device ?? {}),
    subtitle: powerSubtitle(dev.power as never),
    sections: [sectionFor(dev)]
  };
}
