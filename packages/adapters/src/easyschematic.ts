// The EasySchematic adapter: converts a validated ODIO device into an
// EasySchematic bulk-import document ({ templates: [DeviceTemplate] }).

import {
  validate,
  validateDocument,
  flattenBundle,
  formatErrors,
  poeBudget,
  estimatedBtuPerHour,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice,
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
function deriveVoltage(device: DeviceView): string | undefined {
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
 * The device fields `buildTemplate` reads: identity + ports + optional power/
 * physical facets. Both a full {@link OdioDevice} document and a bundle's
 * {@link FlattenedDevice} leaf satisfy this shape.
 */
type DeviceView = Pick<OdioDevice, "device" | "ports" | "power" | "physical">;

/** Extra annotations the bundle adapter layers onto a leaf-device template. */
interface TemplateExtras {
  /** Additional search terms (e.g. the kit part number) to merge in. */
  extraSearchTerms?: string[];
  /** Effective quantity for this leaf (>1 -> set template.quantity). */
  quantity?: number;
}

/**
 * Build the EasySchematic device template for an ODIO device.
 */
function buildTemplate(
  device: DeviceView,
  warnings: string[],
  extras: TemplateExtras = {}
): EsDeviceTemplate {
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
    template.thermalBtuh = estimatedBtuPerHour(device as OdioDevice);
  }

  const poeBudgetW = poeBudget(device as OdioDevice);
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

  const searchTerms = [manufacturer, modelNumber, d.productLine, ...(extras.extraSearchTerms ?? [])]
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    // De-duplicate while preserving order.
    .filter((t, i, arr) => arr.indexOf(t) === i);
  if (searchTerms.length > 0) template.searchTerms = searchTerms;

  if (typeof extras.quantity === "number" && extras.quantity > 1) {
    template.quantity = extras.quantity;
  }

  return template;
}

/** A structural view of a cable end exposing the fields this adapter reads. */
interface CableEndView {
  label?: string;
  connector: string;
  connectorOther?: string;
}

/**
 * Build an EasySchematic cable-accessory template for a single distinct cable.
 *
 * The cable is modeled as a DeviceTemplate with `isCableAccessory: true` and one
 * bidirectional port per cable END. Each port's connectorType is mapped from the
 * end connector via {@link mapConnector}; its signalType is mapped from the
 * cable's first carried signal via {@link mapSignalType} (falling back to
 * "custom"/per-domain with a warning when the cable carries nothing explicit).
 */
function buildCableTemplate(
  cable: CableBody,
  warnings: string[],
  extras: TemplateExtras = {}
): EsDeviceTemplate {
  const manufacturer = cable.manufacturer ?? "";
  const modelNumber = cable.model ?? cable.sku ?? cable.label ?? "";
  const label = (cable.label ?? `${manufacturer} ${modelNumber}`).trim() || "cable";
  const idBase = slug(`${manufacturer}-${modelNumber}` || label);

  // Determine the carried signal used to type every end. Cables usually carry a
  // single end-to-end flow; we use the first carried signal for all ends.
  const carries = (cable.carries ?? []).map(sig);
  const primary = carries[0];
  if (!primary) {
    warnings.push(
      `Cable "${modelNumber || label}": no carried signal declared; cable ports typed "custom".`
    );
  }

  const ends = (cable.ends ?? []) as CableEndView[];
  const usedIds = new Set<string>();
  const ports: EsPort[] = [];
  for (let i = 0; i < ends.length; i++) {
    const end = ends[i];
    const portRef = `${modelNumber || label} end ${i + 1}`;
    const connectorType: EsConnectorType = mapConnector(
      end.connector,
      end.connectorOther,
      warnings,
      portRef
    );
    const signalType: EsSignalType = primary
      ? mapSignalType(primary.domain, primary.transport, warnings, portRef)
      : "custom";

    const endLabel = end.label ?? `End ${i + 1}`;
    let id = `${idBase}-end-${i + 1}`;
    let dedupe = 1;
    while (usedIds.has(id)) {
      id = `${idBase}-end-${i + 1}-${dedupe++}`;
    }
    usedIds.add(id);

    ports.push({
      id,
      label: endLabel,
      signalType,
      direction: "bidirectional",
      connectorType,
      section: "Cable ends"
    });
  }

  const template: EsDeviceTemplate = {
    label,
    deviceType: "cable",
    category: "cable",
    manufacturer,
    modelNumber,
    model: modelNumber || undefined,
    ports,
    isCableAccessory: true
  };

  const searchTerms = [
    manufacturer,
    modelNumber,
    cable.sku,
    cable.lengthLabel,
    ...(extras.extraSearchTerms ?? [])
  ]
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .filter((t, i, arr) => arr.indexOf(t) === i);
  if (searchTerms.length > 0) template.searchTerms = searchTerms;

  if (typeof extras.quantity === "number" && extras.quantity > 1) {
    template.quantity = extras.quantity;
  }

  return template;
}

/**
 * Expand a validated ODIO bundle into EasySchematic templates: one device
 * template per leaf device (replicated by effective quantity) plus one
 * cable-accessory template per distinct cable. The kit part number is added to
 * every template's searchTerms for traceability.
 */
function buildBundleTemplates(bundle: Bundle, warnings: string[]): EsDeviceTemplate[] {
  const flat = flattenBundle(bundle);
  const kitModel = bundle.bundle?.model;
  const kitManufacturer = bundle.bundle?.manufacturer;
  const kitTerms = [kitModel, kitManufacturer].filter(
    (t): t is string => typeof t === "string" && t.length > 0
  );

  const templates: EsDeviceTemplate[] = [];

  for (const entry of flat.devices) {
    const view = entry.device as FlattenedDevice;
    if (!view.device?.manufacturer || !view.device?.model) {
      warnings.push(
        `Bundle leaf "${entry.path.join(" / ")}": device is missing manufacturer/model; skipped.`
      );
      continue;
    }
    const qty = entry.quantity >= 1 ? entry.quantity : 1;
    if (qty > 1) {
      // Emit one disambiguated template per physical instance, mirroring how
      // device-level port `count` is expanded into distinct units.
      for (let unit = 1; unit <= qty; unit++) {
        const t = buildTemplate(view, warnings, { extraSearchTerms: kitTerms });
        t.label = `${t.label} (${unit} of ${qty})`;
        templates.push(t);
      }
    } else {
      templates.push(buildTemplate(view, warnings, { extraSearchTerms: kitTerms }));
    }
  }

  for (const entry of flat.cables) {
    const qty = entry.quantity >= 1 ? entry.quantity : 1;
    // Cables: emit one template carrying the effective quantity (set on
    // template.quantity) rather than N duplicate templates. This keeps the
    // cable library compact; the quantity field records how many are used.
    templates.push(
      buildCableTemplate(entry.cable as CableBody, warnings, {
        extraSearchTerms: kitTerms,
        quantity: qty
      })
    );
  }

  for (const ref of flat.unresolvedRefs) {
    warnings.push(
      `Unresolved ${ref.type} reference at "${ref.path.join(" / ")}" (id: ${
        (ref.ref as { id?: string }).id ?? "?"
      }); not expanded into a template.`
    );
  }

  if (templates.length === 0) {
    throw new Error(
      "EasySchematic adapter: bundle expanded to zero templates (no inline devices or cables)."
    );
  }

  return templates;
}

/**
 * The EasySchematic adapter. Validates input with the SDK, then emits a single
 * JSON file containing `{ templates: [...] }`.
 *
 * Accepts either a device document or a bundle (kit) document. A bundle is
 * flattened via the SDK and expanded into one template per leaf device plus a
 * cable-accessory template per distinct cable. Single-device input behavior is
 * unchanged.
 */
export const EasySchematicAdapter: Adapter = {
  id: "easyschematic",
  label: "EasySchematic (bulk device-template import)",
  fileExtension: "json",

  export(device: OdioDevice): AdapterResult {
    // Route by document kind. validateDocument inspects top-level `kind`
    // ("bundle"/"cable") and validates against the matching schema; device
    // documents have no `kind`.
    const routed = validateDocument(device);
    if (!routed.valid) {
      throw new Error(
        `EasySchematic adapter: input is not a valid OpenDeviceIO ${routed.kind} document:\n${formatErrors(
          routed.errors
        )}`
      );
    }

    const warnings: string[] = [];
    let templates: EsDeviceTemplate[];
    let fileBase: string;

    if (routed.kind === "bundle") {
      const bundle = device as unknown as Bundle;
      templates = buildBundleTemplates(bundle, warnings);
      fileBase = slug(
        `${bundle.bundle?.manufacturer ?? ""}-${bundle.bundle?.model ?? "bundle"}`
      );
    } else if (routed.kind === "cable") {
      // A standalone cable document is wrapped as a single cable-accessory
      // template for consistency with how bundle cables are emitted.
      const cable = (device as unknown as { cable: CableBody }).cable;
      const template = buildCableTemplate(cable, warnings);
      if (!template.manufacturer || !template.modelNumber) {
        throw new Error(
          `EasySchematic adapter: cable must have a non-empty manufacturer and model number.`
        );
      }
      templates = [template];
      fileBase = slug(`${template.manufacturer}-${template.modelNumber}`);
    } else {
      // Single device (unchanged behavior).
      const result = validate(device);
      if (!result.valid) {
        throw new Error(
          `EasySchematic adapter: input is not a valid OpenDeviceIO document:\n${formatErrors(
            result.errors
          )}`
        );
      }
      const template = buildTemplate(device, warnings);
      // Guard the importer's hard requirements explicitly.
      if (!template.manufacturer || !template.modelNumber || template.modelNumber === "custom") {
        throw new Error(
          `EasySchematic adapter: device must have a non-empty manufacturer and a model number (not "custom").`
        );
      }
      templates = [template];
      fileBase = slug(`${template.manufacturer}-${template.modelNumber}`);
    }

    const doc = { templates };
    const content = JSON.stringify(doc, null, 2) + "\n";

    return {
      files: [{ path: `${fileBase}.easyschematic.json`, content }],
      warnings
    };
  }
};
