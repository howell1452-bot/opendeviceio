// Shared per-connector port-expansion model used by every schematic adapter
// (EasySchematic, DXF, Visio). It implements the "one port per physical
// connector" model: an ODIO port is count-expanded into one entry per physical
// connector instance, each typed by a single PRIMARY signal chosen by domain
// priority (video > audio > control > network > data > power). The remaining
// concurrent flows on the connector are summarized rather than lost.
//
// EasySchematic, DXF, and Visio all consume this so the three adapters agree on
// exactly which terminals a device exposes and how they are labeled/typed.

import type { OdioDevice, Port, Signal } from "@opendeviceio/sdk";

/** Port direction as used by the shared model (matches the ODIO port direction). */
export type PortDirection = "input" | "output" | "bidirectional";

/** Structural view of a signal exposing the fields the expander reads. */
export interface SignalView {
  domain: string;
  transport?: string;
  direction?: PortDirection;
  channels?: number;
  maxResolution?: string;
  maxRefreshHz?: number;
  colorDepthBits?: number;
}

function sig(signal: Signal): SignalView {
  return signal as unknown as SignalView;
}

/** Embedded audio transports that ride a co-located video connector. */
const EMBEDDED_AUDIO_TRANSPORTS = new Set(["lpcm", "arc", "earc"]);

/**
 * Domain priority for choosing a connector's single PRIMARY signal. A physical
 * connector carrying multiple flows collapses to one terminal typed by the
 * first present domain in this order.
 */
export const PRIMARY_DOMAIN_PRIORITY = [
  "video",
  "audio",
  "control",
  "network",
  "data",
  "power"
] as const;

/** Pick the primary signal of an ODIO port by domain priority (first present). */
function pickPrimary(signals: SignalView[]): SignalView | undefined {
  for (const domain of PRIMARY_DOMAIN_PRIORITY) {
    const found = signals.find((s) => s.domain === domain);
    if (found) return found;
  }
  return signals[0];
}

/**
 * Concise descriptor for a signal in carried-signal notes. Uses the transport
 * when present (e.g. "displayport", "usb-data"), except for the power domain
 * where the broad "power" reads better than transports like "usb-pd"/"dc".
 */
function signalDescriptor(view: SignalView): string {
  if (view.domain === "power") return "power";
  return view.transport ?? view.domain;
}

/** Slugify a string into an id-safe fragment. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

/**
 * One expanded terminal: a single physical connector instance, typed by its
 * primary signal. This is the unit every schematic adapter renders/imports.
 */
export interface ExpandedConnector {
  /** Unique id within the device (slug, count-disambiguated). */
  id: string;
  /** Human-facing label (port label + unit number when count > 1). */
  label: string;
  /** Overall direction of the terminal. */
  direction: PortDirection;
  /** ODIO connector (physical jack) vocabulary value, e.g. "hdmi-type-a". */
  connector: string;
  /** Free-text connector name when connector === "other". */
  connectorOther?: string;
  /** Domain of the primary signal ("video"/"audio"/…), or undefined if none. */
  primaryDomain?: string;
  /** Transport of the primary signal, when present. */
  primaryTransport?: string;
  /**
   * The non-primary flows carried on the same connector (descriptors), e.g.
   * ["usb-data", "power"]. Distinct and order-preserving.
   */
  carries: string[];
  /** Channel count of the primary signal when > 1 (e.g. 8 GPIO circuits). */
  channels?: number;
  /** Logical grouping label (port label / location group / id). */
  section: string;
  /**
   * Combined human notes: the port's own notes + a "Carries:" summary of the
   * non-primary flows + an embedded-audio fold-in. Undefined when empty.
   */
  notes?: string;
  /** The primary {@link SignalView}, exposed for adapters needing capabilities. */
  primary?: SignalView;
}

/**
 * Expand a single ODIO port into one {@link ExpandedConnector} per physical
 * connector instance (replicated across `port.count`).
 *
 * Each terminal is typed by a PRIMARY signal chosen by domain priority; the
 * other concurrent flows are summarized in `carries`/`notes`. Embedded audio
 * (lpcm/arc/earc riding a video connector) is folded into the note, not emitted
 * as a separate flow — matching the EasySchematic per-connector model.
 */
export function expandPort(port: Port, usedIds: Set<string>): ExpandedConnector[] {
  const portId = port.id;
  const portLabel = port.label;
  const groupLabel = portLabel ?? port.location?.group ?? portId;
  const count = typeof port.count === "number" && port.count >= 1 ? port.count : 1;

  const signals = port.signals.map(sig);
  const primary = pickPrimary(signals);
  const hasVideo = primary?.domain === "video" || signals.some((s) => s.domain === "video");

  const embeddedAudio = hasVideo
    ? signals.filter(
        (s) => s.domain === "audio" && EMBEDDED_AUDIO_TRANSPORTS.has(s.transport ?? "")
      )
    : [];

  // The other (non-primary, non-embedded) signals carried on this connector.
  const carriedDistinct = signals
    .filter((s) => s !== primary && !embeddedAudio.includes(s))
    .map(signalDescriptor)
    .filter((d, i, arr) => arr.indexOf(d) === i);

  const embeddedNote =
    embeddedAudio.length > 0
      ? `Embedded audio: ${embeddedAudio
          .map((s) => s.transport ?? "audio")
          .join(", ")} (carried on the video connector).`
      : undefined;
  const carriesNote = carriedDistinct.length > 0 ? `Carries: ${carriedDistinct.join(", ")}` : undefined;

  const noteParts: string[] = [];
  if (typeof port.notes === "string" && port.notes.length > 0) noteParts.push(port.notes);
  if (carriesNote) noteParts.push(carriesNote);
  if (embeddedNote) noteParts.push(embeddedNote);
  const notes = noteParts.length > 0 ? noteParts.join(" ") : undefined;

  const channels =
    primary && typeof primary.channels === "number" && primary.channels > 1
      ? primary.channels
      : undefined;
  // Direction: prefer the ODIO port direction, fall back to the primary signal's.
  const direction: PortDirection =
    (port.direction as PortDirection) ?? primary?.direction ?? "bidirectional";

  const result: ExpandedConnector[] = [];
  for (let unit = 1; unit <= count; unit++) {
    const unitSuffix = count > 1 ? ` ${unit}` : "";
    const label = `${portLabel ?? portId}${unitSuffix}`;

    const baseId = `${slug(portId)}${count > 1 ? `-${unit}` : ""}`;
    let id = baseId;
    let dedupe = 1;
    while (usedIds.has(id)) {
      id = `${baseId}-${dedupe++}`;
    }
    usedIds.add(id);

    result.push({
      id,
      label,
      direction,
      connector: port.connector,
      connectorOther: port.connectorOther,
      primaryDomain: primary?.domain,
      primaryTransport: primary?.transport,
      carries: carriedDistinct,
      channels,
      section: groupLabel,
      notes,
      primary
    });
  }
  return result;
}

/** A device view exposing just the ports the expander reads. */
type PortsView = Pick<OdioDevice, "ports">;

/**
 * Expand all of a device's ports into the shared per-connector terminal model.
 * Ids are unique across the returned list.
 */
export function expandConnectors(device: PortsView): ExpandedConnector[] {
  const usedIds = new Set<string>();
  const out: ExpandedConnector[] = [];
  for (const port of device.ports) {
    out.push(...expandPort(port, usedIds));
  }
  return out;
}
