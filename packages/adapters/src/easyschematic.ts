// The EasySchematic adapter: converts a validated ODIO device into EasySchematic
// device templates. Two output envelopes are supported:
//   - "array" (default): a bare JSON array of templates, the format accepted by
//     EasySchematic's in-app device-creation JSON importer.
//   - "bulk": the { templates: [...] } wrapper used by the vendor-DB seed import.

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
  EsExportOptions,
  EsFormat,
  EsPort,
  EsPortCapabilities,
  EsSignalType
} from "./types.js";
import { mapConnector, mapSignalType } from "./mappings.js";
import { expandConnectors, type ExpandedConnector, type SignalView } from "./ports.js";

function sig(signal: Signal): SignalView {
  return signal as unknown as SignalView;
}

/**
 * The set of deviceType values EasySchematic's in-app importer accepts. The
 * importer HARD-ERRORS on any value outside this set, so every emitted template
 * must use exactly one of these.
 */
const VALID_DEVICE_TYPES: ReadonlySet<string> = new Set([
  "camera","ptz-camera","camera-ccu","graphics","computer","media-player","mouse","keyboard",
  "video-bar","touch-screen","screen","switcher","router","converter","scaler","adapter",
  "frame-sync","multiviewer","capture-card","chromakey","da","video-wall-controller","monitor",
  "tv","projector","recorder","audio-mixer","audio-embedder","audio-interface","audio-dsp",
  "equalizer","stage-box","audio-splitter","wireless-mic-receiver","speaker","amplifier",
  "headphone-amplifier","monitor-controller","personal-monitor","ndi-encoder","ndi-decoder",
  "network-switch","streaming-encoder","av-over-ip","kvm-extender","usb-extender",
  "hdbaset-extender","wireless-video","intercom","led-processor","led-cabinet","media-server",
  "lighting-console","moving-light","led-fixture","dmx-splitter","dmx-node","control-processor",
  "tally-system","ptz-controller","sync-generator","timecode-generator","midi-device",
  "control-expansion","cable-accessory","wired-mic","iem-transmitter","change-over",
  "expansion-card","fiber-transmitter","company-switch","frame","power-distribution",
  "patch-panel","wall-plate","presentation-system","wireless-presentation","cloud-service",
  "codec","expansion-chassis","power-mixer","hdmi-splitter","network-router","nas",
  "external-storage","storage-media","lighting-processor","network-wifi","access-point",
  "intercom-transceiver","controller","button-panel","dock","studio-monitor","video-scope",
  "audio-meter","assistive-listening","battery","commentary-box","phone-hybrid",
  "interpreter-desk","table-box","antenna","antenna-distribution","conference-system","di-box",
  "display","charging-station","audio-bar","mtr-pc","touch-controller","occupancy-sensor"
]);

/**
 * Best-effort map from a normalized ODIO category dotted path to a valid
 * EasySchematic deviceType. Keys are matched against the full lowercased path
 * (substring) and against individual path segments, most-specific first.
 */
const CATEGORY_DEVICE_TYPE: ReadonlyArray<readonly [string, string]> = [
  // Order matters: earlier, more specific entries win.
  ["switcher/matrix", "switcher"],
  ["audio/dsp", "audio-dsp"],
  ["processor/dsp", "audio-dsp"],
  ["network/switch", "network-switch"],
  ["network/adapter", "adapter"],
  ["extender/transmitter", "hdbaset-extender"],
  ["control/touch-panel", "touch-screen"],
  ["compute/uc-engine", "mtr-pc"],
  ["conferencing/kit", "presentation-system"],
  ["microphone/mic", "wired-mic"],
  ["display/monitor", "display"],
  ["occupancy-sensor", "occupancy-sensor"],
  // Single-segment / generic fallbacks.
  ["switcher", "switcher"],
  ["matrix", "switcher"],
  ["dsp", "audio-dsp"],
  ["network-switch", "network-switch"],
  ["extender", "hdbaset-extender"],
  ["adapter", "adapter"],
  ["touch-panel", "touch-screen"],
  ["uc-engine", "mtr-pc"],
  ["converter", "converter"],
  ["transmitter", "wireless-presentation"],
  ["assembly", "presentation-system"],
  ["kit", "presentation-system"],
  ["camera", "camera"],
  ["microphone", "wired-mic"],
  ["mic", "wired-mic"],
  ["monitor", "display"],
  ["display", "display"],
  ["amplifier", "amplifier"],
  ["codec", "codec"],
  ["dock", "dock"]
];

/** Per signal-domain fallback deviceType when no category match is found. */
const DOMAIN_DEVICE_TYPE: Readonly<Record<string, string>> = {
  video: "converter",
  audio: "audio-dsp",
  network: "network-switch",
  control: "control-processor",
  data: "converter",
  power: "power-distribution"
};

/**
 * Determine the device's dominant signal domain by counting emitted signals
 * across all ports. Returns undefined when the device has no signals.
 */
function dominantDomain(device: DeviceView): string | undefined {
  const counts: Record<string, number> = {};
  for (const port of device.ports) {
    for (const signal of port.signals) {
      const domain = sig(signal).domain;
      if (domain) counts[domain] = (counts[domain] ?? 0) + 1;
    }
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [domain, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = domain;
      bestN = n;
    }
  }
  return best;
}

/**
 * Map an ODIO device to a valid EasySchematic deviceType. Tries the category
 * dotted path first; on no match, falls back to the dominant signal domain (and
 * finally "converter"), pushing a warning whenever a fallback is used.
 */
function mapDeviceType(device: DeviceView, warnings: string[]): string {
  const category = device.device.category;
  const label = `${device.device.manufacturer ?? ""} ${device.device.model ?? ""}`.trim() || "device";
  if (category) {
    const haystack = category.toLowerCase();
    for (const [key, type] of CATEGORY_DEVICE_TYPE) {
      if (key.includes("/")) {
        if (haystack.includes(key)) return type;
      } else {
        // Single token: match a whole path segment.
        if (haystack.split("/").includes(key)) return type;
      }
    }
  }

  // Fallback by dominant signal domain.
  const domain = dominantDomain(device);
  const fallback = (domain && DOMAIN_DEVICE_TYPE[domain]) || "converter";
  // Defensive: the fallback table only ever yields known values, but guard
  // against future edits introducing a typo that would fail the importer.
  const safeFallback = VALID_DEVICE_TYPES.has(fallback) ? fallback : "converter";
  warnings.push(
    `Device "${label}": category "${category ?? "(none)"}" has no deviceType mapping; ` +
      `falling back to "${safeFallback}"${domain ? ` (dominant domain "${domain}")` : ""}.`
  );
  return safeFallback;
}

/** Build a guaranteed-valid http(s) referenceUrl for a device template. */
function deviceReferenceUrl(d: DeviceView["device"], documentId: string | undefined): string {
  const explicit = d.productUrl ?? d.datasheetUrl;
  if (typeof explicit === "string" && /^https?:\/\//.test(explicit)) return explicit;
  const id = documentId ?? slug(`${d.manufacturer ?? ""}-${d.model ?? "device"}`);
  return `https://opendeviceio.org/registry/${id}`;
}

/** Build a guaranteed-valid http(s) referenceUrl for a cable-accessory template. */
function cableReferenceUrl(cable: CableBody, documentId: string | undefined): string {
  const c = cable as { productUrl?: unknown; datasheetUrl?: unknown };
  const explicit =
    (typeof c.productUrl === "string" && c.productUrl) ||
    (typeof c.datasheetUrl === "string" && c.datasheetUrl) ||
    undefined;
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const id =
    documentId ?? slug(`${cable.manufacturer ?? ""}-${cable.model ?? cable.sku ?? cable.label ?? "cable"}`);
  return `https://opendeviceio.org/registry/${id}`;
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
  linkSpeed: string | undefined;
}

function portContext(port: Port): PortContext {
  const link = (port as { link?: { speed?: string; poe?: { role?: string; classWatts?: number } } })
    .link;
  const poe = link?.poe;
  const isPd = poe?.role === "pd" && typeof poe.classWatts === "number";
  return {
    poePd: isPd ? poe!.classWatts : undefined,
    linkSpeed: link?.speed
  };
}

/**
 * Map a shared {@link ExpandedConnector} terminal to an EasySchematic port.
 * EasySchematic models one port = one physical connector with a SINGLE
 * signalType; the shared expander already collapses each ODIO port to one
 * terminal per physical connector instance, typed by a PRIMARY signal. Here we
 * map that primary's (domain, transport) to an EsSignalType and the connector to
 * an EsConnectorType, carry over video capabilities / channel count, and add the
 * port-level PoE-draw / link-speed context (looked up by source port).
 */
function toEsPort(term: ExpandedConnector, ctx: PortContext, warnings: string[]): EsPort {
  const connectorType: EsConnectorType = mapConnector(
    term.connector,
    term.connectorOther,
    warnings,
    term.id
  );
  const signalType: EsSignalType = term.primaryDomain
    ? mapSignalType(term.primaryDomain, term.primaryTransport, warnings, term.id)
    : "custom";
  const direction = mapDirection(term.direction, "bidirectional");

  const esPort: EsPort = {
    id: term.id,
    label: term.label,
    signalType,
    direction,
    connectorType,
    section: term.section
  };

  const caps = term.primary ? buildCapabilities(term.primary) : undefined;
  if (caps) esPort.capabilities = caps;
  if (typeof term.channels === "number") esPort.channelCount = term.channels;
  if (typeof ctx.poePd === "number") esPort.poeDrawW = ctx.poePd;
  if (ctx.linkSpeed && term.primaryDomain === "network") esPort.linkSpeed = ctx.linkSpeed;
  if (term.notes) esPort.notes = term.notes;

  return esPort;
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
  /**
   * The owning document's id, used to build the fallback registry referenceUrl
   * when the device declares no productUrl/datasheetUrl.
   */
  documentId?: string;
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

  // Port-level PoE/link context keyed by the source port id slug, used to
  // annotate each expanded terminal (the shared expander does not carry link
  // details). Terminal ids are `slug(portId)` optionally suffixed with
  // `-<unit>` / `-<dedupe>`, so we match the longest known slug prefix.
  const slugToCtx = new Map<string, PortContext>();
  for (const port of device.ports) {
    slugToCtx.set(slug(port.id), portContext(port));
  }
  const ports: EsPort[] = expandConnectors(device).map((term) => {
    let ctx: PortContext = { poePd: undefined, linkSpeed: undefined };
    let bestLen = -1;
    for (const [s, c] of slugToCtx) {
      if ((term.id === s || term.id.startsWith(`${s}-`)) && s.length > bestLen) {
        ctx = c;
        bestLen = s.length;
      }
    }
    return toEsPort(term, ctx, warnings);
  });

  const consumption = device.power?.consumptionWatts;
  const powerDrawW = consumption?.typical ?? consumption?.max;

  const template: EsDeviceTemplate = {
    label,
    deviceType: mapDeviceType(device, warnings),
    category: deriveCategory(d.category),
    manufacturer,
    modelNumber,
    model: modelNumber,
    referenceUrl: deviceReferenceUrl(d, extras.documentId),
    ports
  };

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
    deviceType: "cable-accessory",
    category: "cable",
    manufacturer,
    modelNumber,
    model: modelNumber || undefined,
    referenceUrl: cableReferenceUrl(cable, extras.documentId),
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
function buildBundleTemplates(
  bundle: Bundle,
  warnings: string[],
  documentId: string | undefined
): EsDeviceTemplate[] {
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
        const t = buildTemplate(view, warnings, { extraSearchTerms: kitTerms, documentId });
        t.label = `${t.label} (${unit} of ${qty})`;
        templates.push(t);
      }
    } else {
      templates.push(buildTemplate(view, warnings, { extraSearchTerms: kitTerms, documentId }));
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
        quantity: qty,
        documentId
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
 * JSON file containing the device templates.
 *
 * Output envelope is controlled by `opts.format`:
 *   - "array" (default): a bare JSON array of templates, the shape accepted by
 *     EasySchematic's in-app device-creation JSON importer.
 *   - "bulk": the legacy `{ templates: [...] }` wrapper used by the vendor-DB
 *     seed import.
 *
 * Accepts either a device document or a bundle (kit) document. A bundle is
 * flattened via the SDK and expanded into one template per leaf device plus a
 * cable-accessory template per distinct cable. Single-device input behavior is
 * unchanged.
 */
export const EasySchematicAdapter: Adapter = {
  id: "easyschematic",
  label: "EasySchematic (device-template import)",
  fileExtension: "json",

  export(device: OdioDevice, opts?: Record<string, unknown>): AdapterResult {
    const format: EsFormat = (opts as EsExportOptions | undefined)?.format === "bulk"
      ? "bulk"
      : "array";

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

    // The owning document's id, used for the fallback registry referenceUrl.
    const documentId = (device as { id?: unknown }).id;
    const docId = typeof documentId === "string" ? documentId : undefined;

    const warnings: string[] = [];
    let templates: EsDeviceTemplate[];
    let fileBase: string;

    if (routed.kind === "bundle") {
      const bundle = device as unknown as Bundle;
      templates = buildBundleTemplates(bundle, warnings, docId);
      fileBase = slug(
        `${bundle.bundle?.manufacturer ?? ""}-${bundle.bundle?.model ?? "bundle"}`
      );
    } else if (routed.kind === "cable") {
      // A standalone cable document is wrapped as a single cable-accessory
      // template for consistency with how bundle cables are emitted.
      const cable = (device as unknown as { cable: CableBody }).cable;
      const template = buildCableTemplate(cable, warnings, { documentId: docId });
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
      const template = buildTemplate(device, warnings, { documentId: docId });
      // Guard the importer's hard requirements explicitly.
      if (!template.manufacturer || !template.modelNumber || template.modelNumber === "custom") {
        throw new Error(
          `EasySchematic adapter: device must have a non-empty manufacturer and a model number (not "custom").`
        );
      }
      templates = [template];
      fileBase = slug(`${template.manufacturer}-${template.modelNumber}`);
    }

    // Envelope: bare array (in-app importer) or { templates } (bulk seed).
    const doc: unknown = format === "bulk" ? { templates } : templates;
    const content = JSON.stringify(doc, null, 2) + "\n";

    return {
      files: [{ path: `${fileBase}.easyschematic.json`, content }],
      warnings
    };
  }
};
