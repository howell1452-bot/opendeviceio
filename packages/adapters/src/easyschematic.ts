// The EasySchematic adapter: converts a validated ODIO device into an
// EasySchematic bulk-import document ({ templates: [DeviceTemplate] }).

import {
  validate,
  formatErrors,
  poeBudget,
  estimatedBtuPerHour,
  type OdioDevice,
  type Port,
  type Signal
} from "@opendeviceio/sdk";

import type {
  Adapter,
  AdapterResult,
  EsConnectorType,
  EsDeviceTemplate,
  EsDirection,
  EsPort,
  EsPortCapabilities,
  EsSignalType
} from "./types.js";
import { mapConnector, mapSignalType } from "./mappings.js";

/** Structural view of a signal exposing the fields this adapter reads. */
interface SignalView {
  domain: string;
  transport?: string;
  direction?: EsDirection;
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

/** Map an ODIO category path to an EasySchematic deviceType. */
function deriveDeviceType(category: string | undefined): string {
  if (!category) return "other";
  const segments = category.split("/");
  const haystack = category.toLowerCase();
  // Prefer the most specific (last) segment, then fall back to keyword scan.
  const direct: Record<string, string> = {
    switch: "switch",
    switcher: "switcher",
    matrix: "switcher",
    dsp: "dsp",
    extender: "extender",
    transmitter: "extender",
    receiver: "extender",
    display: "display",
    monitor: "display",
    camera: "camera",
    amplifier: "amplifier",
    amp: "amplifier"
  };
  for (let i = segments.length - 1; i >= 0; i--) {
    const hit = direct[segments[i]];
    if (hit) return hit;
  }
  if (haystack.includes("switcher") || haystack.includes("matrix")) return "switcher";
  if (haystack.includes("switch")) return "switch";
  if (haystack.includes("dsp")) return "dsp";
  if (haystack.includes("extender")) return "extender";
  if (haystack.includes("display") || haystack.includes("monitor")) return "display";
  if (haystack.includes("camera")) return "camera";
  if (haystack.includes("amplifier") || haystack.includes("amp")) return "amplifier";
  return "other";
}

/** Map an ODIO category path to a coarse EasySchematic category. */
function deriveCategory(category: string | undefined): string {
  if (!category) return "other";
  const h = category.toLowerCase();
  if (h.includes("video") || h.includes("switcher") || h.includes("display") || h.includes("camera"))
    return "video";
  if (h.includes("audio") || h.includes("dsp") || h.includes("amplifier")) return "audio";
  if (h.includes("network") || h.includes("switch")) return "network";
  if (h.includes("control")) return "control";
  if (h.includes("power")) return "power";
  return "other";
}

/** Derive a voltage string from the device's power inputs. */
function deriveVoltage(device: OdioDevice): string | undefined {
  const inputs = device.power?.inputs;
  if (!inputs || inputs.length === 0) return undefined;
  for (const input of inputs) {
    if (input.voltageRange) return input.voltageRange;
    if (typeof input.nominalVoltage === "number") return `${input.nominalVoltage}V`;
  }
  return undefined;
}

/** Map an ODIO direction (or signal direction) to an EasySchematic direction. */
function mapDirection(value: string | undefined, fallback: string): EsDirection {
  const v = value ?? fallback;
  switch (v) {
    case "input":
    case "output":
    case "bidirectional":
      return v;
    default:
      return "bidirectional";
  }
}

/** Build the capabilities block for a video signal, if any fields are present. */
function buildCapabilities(view: SignalView): EsPortCapabilities | undefined {
  if (view.domain !== "video") return undefined;
  const caps: EsPortCapabilities = {};
  if (view.maxResolution) caps.maxResolution = view.maxResolution;
  if (typeof view.maxRefreshHz === "number") caps.maxFrameRate = view.maxRefreshHz;
  if (typeof view.colorDepthBits === "number") caps.maxBitDepth = view.colorDepthBits;
  return Object.keys(caps).length > 0 ? caps : undefined;
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

interface PortContext {
  poePd: number | undefined;
  poePse: boolean;
  linkSpeed: string | undefined;
}

function portContext(port: Port): PortContext {
  const link = (port as { link?: { speed?: string; poe?: { role?: string; classWatts?: number } } })
    .link;
  const poe = link?.poe;
  const isPd = poe?.role === "pd" && typeof poe.classWatts === "number";
  const isPse = poe?.role === "pse";
  return {
    poePd: isPd ? poe!.classWatts : undefined,
    poePse: isPse,
    linkSpeed: link?.speed
  };
}

/**
 * Build the EasySchematic ports for a single ODIO port, expanding one ES port
 * per emitted signal and replicating across `count`.
 */
function expandPort(
  port: Port,
  warnings: string[],
  usedIds: Set<string>
): EsPort[] {
  const portId = port.id;
  const portLabel = port.label;
  const groupLabel = portLabel ?? port.location?.group ?? portId;
  const connectorType: EsConnectorType = mapConnector(
    port.connector,
    port.connectorOther,
    warnings,
    portId
  );
  const ctx = portContext(port);
  const count = typeof port.count === "number" && port.count >= 1 ? port.count : 1;

  const signals = port.signals.map(sig);

  // Determine embedded audio: present only when there is a video signal AND an
  // audio signal whose transport is lpcm/arc/earc. Those audio flows ride the
  // video connector, so we do not emit a separate port for them — we note them
  // on the video port instead.
  const hasVideo = signals.some((s) => s.domain === "video");
  const embeddedAudio = hasVideo
    ? signals.filter(
        (s) => s.domain === "audio" && EMBEDDED_AUDIO_TRANSPORTS.has(s.transport ?? "")
      )
    : [];
  const embeddedNote =
    embeddedAudio.length > 0
      ? `Embedded audio: ${embeddedAudio
          .map((s) => s.transport ?? "audio")
          .join(", ")} (carried on the video connector).`
      : undefined;

  // Signals that get their own ES port.
  const emittedSignals = signals.filter((s) => !embeddedAudio.includes(s));

  // For the embedded note we attach it to the first video signal's port.
  let embeddedNoteAttached = false;

  const result: EsPort[] = [];

  for (let unit = 1; unit <= count; unit++) {
    const unitSuffix = count > 1 ? ` ${unit}` : "";
    for (let si = 0; si < emittedSignals.length; si++) {
      const view = emittedSignals[si];
      const signalType: EsSignalType = mapSignalType(
        view.domain,
        view.transport,
        warnings,
        portId
      );

      // Label: when the port carries a single emitted signal, use the port
      // label; otherwise combine the port label with the signal descriptor.
      const signalDescriptor = view.transport ?? view.domain;
      const baseLabel =
        emittedSignals.length === 1
          ? portLabel ?? `${portId} ${signalDescriptor}`
          : `${portLabel ?? portId} — ${signalDescriptor}`;
      const label = `${baseLabel}${unitSuffix}`;

      // Unique id.
      const baseId = `${slug(portId)}-${slug(signalDescriptor)}${count > 1 ? `-${unit}` : ""}`;
      let id = baseId;
      let dedupe = 1;
      while (usedIds.has(id)) {
        id = `${baseId}-${dedupe++}`;
      }
      usedIds.add(id);

      const esPort: EsPort = {
        id,
        label,
        signalType,
        direction: mapDirection(view.direction, port.direction),
        connectorType,
        section: groupLabel
      };

      const caps = buildCapabilities(view);
      if (caps) esPort.capabilities = caps;

      if (typeof view.channels === "number" && view.channels > 1) {
        esPort.channelCount = view.channels;
      }

      if (typeof ctx.poePd === "number") {
        esPort.poeDrawW = ctx.poePd;
      }

      if (ctx.linkSpeed && view.domain === "network") {
        esPort.linkSpeed = ctx.linkSpeed;
      }

      // Combine port notes + embedded-audio note onto the first video port.
      const noteParts: string[] = [];
      if (typeof port.notes === "string" && port.notes.length > 0) {
        noteParts.push(port.notes);
      }
      if (!embeddedNoteAttached && embeddedNote && view.domain === "video") {
        noteParts.push(embeddedNote);
        embeddedNoteAttached = true;
      }
      if (noteParts.length > 0) {
        esPort.notes = noteParts.join(" ");
      }

      result.push(esPort);
    }
    // Reset embedded-note attachment per unit so each replicated unit records
    // its embedded audio on its own first video port.
    embeddedNoteAttached = false;
  }

  return result;
}

/**
 * Build the EasySchematic device template for an ODIO device.
 */
function buildTemplate(device: OdioDevice, warnings: string[]): EsDeviceTemplate {
  const d = device.device;
  const manufacturer = d.manufacturer;
  const modelNumber = d.model;
  const label = `${manufacturer} ${modelNumber}`.trim();

  const usedIds = new Set<string>();
  const ports: EsPort[] = [];
  for (const port of device.ports) {
    ports.push(...expandPort(port, warnings, usedIds));
  }

  const consumption = device.power?.consumptionWatts;
  const powerDrawW = consumption?.typical ?? consumption?.max;

  const template: EsDeviceTemplate = {
    label,
    deviceType: deriveDeviceType(d.category),
    category: deriveCategory(d.category),
    manufacturer,
    modelNumber,
    model: modelNumber,
    ports
  };

  const referenceUrl = d.productUrl ?? d.datasheetUrl;
  if (referenceUrl) template.referenceUrl = referenceUrl;

  if (typeof powerDrawW === "number") template.powerDrawW = powerDrawW;

  const voltage = deriveVoltage(device);
  if (voltage) template.voltage = voltage;

  // thermalBtuh: passthrough power.heatBtuPerHour when present, else derived.
  if (device.power) {
    template.thermalBtuh = estimatedBtuPerHour(device);
  }

  const poeBudgetW = poeBudget(device);
  if (poeBudgetW > 0) template.poeBudgetW = poeBudgetW;

  // poeDrawW: sum of link.poe.classWatts where role === 'pd', times count.
  let poeDrawW = 0;
  for (const port of device.ports) {
    const poe = (port as { link?: { poe?: { role?: string; classWatts?: number } } }).link?.poe;
    if (poe?.role === "pd" && typeof poe.classWatts === "number") {
      const count = typeof port.count === "number" && port.count >= 1 ? port.count : 1;
      poeDrawW += poe.classWatts * count;
    }
  }
  if (poeDrawW > 0) template.poeDrawW = poeDrawW;

  const dims = device.physical?.dimensionsMm;
  if (dims) {
    if (typeof dims.height === "number") template.heightMm = dims.height;
    if (typeof dims.width === "number") template.widthMm = dims.width;
    if (typeof dims.depth === "number") template.depthMm = dims.depth;
  }

  const weightGrams = device.physical?.weightGrams;
  if (typeof weightGrams === "number") template.weightKg = weightGrams / 1000;

  const searchTerms = [manufacturer, modelNumber, d.productLine].filter(
    (t): t is string => typeof t === "string" && t.length > 0
  );
  if (searchTerms.length > 0) template.searchTerms = searchTerms;

  return template;
}

/**
 * The EasySchematic adapter. Validates input with the SDK, then emits a single
 * JSON file containing `{ templates: [template] }`.
 */
export const EasySchematicAdapter: Adapter = {
  id: "easyschematic",
  label: "EasySchematic (bulk device-template import)",
  fileExtension: "json",

  export(device: OdioDevice): AdapterResult {
    const result = validate(device);
    if (!result.valid) {
      throw new Error(
        `EasySchematic adapter: input is not a valid OpenDeviceIO document:\n${formatErrors(
          result.errors
        )}`
      );
    }

    const warnings: string[] = [];
    const template = buildTemplate(device, warnings);

    // Guard the importer's hard requirements explicitly.
    if (!template.manufacturer || !template.modelNumber || template.modelNumber === "custom") {
      throw new Error(
        `EasySchematic adapter: device must have a non-empty manufacturer and a model number (not "custom").`
      );
    }

    const doc = { templates: [template] };
    const content = JSON.stringify(doc, null, 2) + "\n";

    const fileBase = slug(`${template.manufacturer}-${template.modelNumber}`);
    return {
      files: [{ path: `${fileBase}.easyschematic.json`, content }],
      warnings
    };
  }
};
