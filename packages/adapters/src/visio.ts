// Microsoft Visio adapter (target "visio", emits a .vssx STENCIL).
//
// This adapter produces a Visio 2013+ STENCIL (.vssx), NOT a drawing (.vsdx).
// A stencil is an OPC (Open Packaging Conventions) ZIP package whose content is
// a collection of MASTER shapes — the draggable blocks that appear in Visio's
// "Shapes" stencil pane. Each ODIO device becomes one master that renders like
// an EasySchematic block: a labeled rectangle with one CONNECTION POINT per
// physical connector, so a user can drag the master onto a page and wire cables
// to the green ✕ connection points.
//
// OPC package layout (stencil):
//
//   [Content_Types].xml                         — part content-type registry
//   _rels/.rels                                 — package root relationships
//   docProps/core.xml, docProps/app.xml         — document properties
//   visio/document.xml                          — VisioDocument root (stencil)
//   visio/_rels/document.xml.rels               — document -> masters + windows
//   visio/masters/masters.xml                   — <Masters> index (one <Master> each)
//   visio/masters/_rels/masters.xml.rels        — masters index -> each master#.xml
//   visio/masters/master1.xml ... masterN.xml   — one <MasterContents> per device
//   visio/windows.xml                           — window state (stencil window)
//
// Each master#.xml holds a single <Shape> with:
//   * a rectangle <Section N="Geometry"> sized to the device's port count,
//   * a <Text> label (device title + one line per port),
//   * a <Section N="Connection"> with one Row per physical connector. Inputs are
//     placed on the LEFT edge (X=0), outputs/bidirectional on the RIGHT edge
//     (X=Width), distributed evenly down the rectangle by Y. Each connection
//     point carries a Prompt cell set to the port label so it is identifiable.
//
// FORMAT SOURCES (researched, see README + final report):
//   * [MS-VSDX] (MS open spec): Document/Masters/Master XML parts, content types
//     and source relationship URIs.
//       - Masters part:  content type "application/vnd.ms-visio.masters+xml",
//                        rel "http://schemas.microsoft.com/visio/2010/relationships/masters"
//       - Master part:   content type "application/vnd.ms-visio.master+xml",
//                        rel "http://schemas.microsoft.com/visio/2010/relationships/master",
//                        root element <MasterContents>
//       - Document part: MS-VSDX documents "application/vnd.ms-visio.drawing.main+xml";
//                        the STENCIL variant uses "application/vnd.ms-visio.stencil.main+xml"
//                        (same naming pattern as the .vssx extension). See CAVEAT.
//   * Visio XML reference (learn.microsoft.com): Cell/Row/Section model — every
//     ShapeSheet cell is a <Cell N=".." V=".."> and tabular data lives in
//     <Section><Row><Cell/></Row></Section>. Connection-row cells use N = X, Y,
//     DirX, DirY, Type, Prompt. Master_Type attributes: ID (required), NameU,
//     Name, plus a required child <Rel r:id=".."> pointing at the master part.
//
// CAVEAT — REAL-VISIO VALIDATION: this is a hand-built minimal stencil targeting
// the documented schema. It is a structurally valid OPC zip carrying real master
// shapes with geometry + connection points (a large step up from the previous
// text-only .vsdx). The exact bytes a pristine Visio writes (master Icon bitmaps,
// full StyleSheet/Theme machinery, PageSheet defaults) are intentionally omitted.
// Treat opening in the real Visio app as still requiring validation; the most
// likely points to verify are listed in the final report / README.

import { zipSync, strToU8, type Zippable } from "fflate";

import {
  validateDocument,
  flattenBundle,
  formatErrors,
  type OdioDevice,
  type Bundle,
  type CableBody,
  type FlattenedDevice
} from "@opendeviceio/sdk";

import type { Adapter, AdapterResult } from "./types.js";
import { expandConnectors, type ExpandedConnector } from "./ports.js";

/** XML-escape a text value for use in element text or attribute. */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/** Device identity fields the adapter reads. */
interface DeviceIdentity {
  manufacturer?: string;
  model?: string;
}
type DeviceView = { device: DeviceIdentity; ports: OdioDevice["ports"] };

function deviceTitle(d: DeviceIdentity): string {
  const t = `${d.manufacturer ?? ""} ${d.model ?? ""}`.trim();
  return t.length > 0 ? t : "Device";
}

function portTypeLabel(t: ExpandedConnector): string {
  return t.primaryTransport ?? t.primaryDomain ?? t.connector;
}

// --- Static OPC parts -------------------------------------------------------
//
// Content-type Overrides for the STENCIL document part + the masters/master
// parts (see [MS-VSDX]). The document part uses the .stencil content type so the
// package is recognised as a .vssx stencil rather than a .vsdx drawing.

function buildContentTypes(masterCount: number): string {
  const masterOverrides: string[] = [];
  for (let i = 1; i <= masterCount; i++) {
    masterOverrides.push(
      `<Override PartName="/visio/masters/master${i}.xml" ContentType="application/vnd.ms-visio.master+xml"/>`
    );
  }
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    // STENCIL document part (.vssx) — note ".stencil." not ".drawing.".
    '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.stencil.main+xml"/>' +
    '<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>' +
    masterOverrides.join("") +
    '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  );
}

const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  "</Relationships>";

const DOCUMENT_XML =
  XML_DECL +
  '<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">' +
  "<DocumentSettings/>" +
  "<Colors/>" +
  "<FaceNames/>" +
  "<StyleSheets/>" +
  "</VisioDocument>";

// Document -> masters index + windows. (No pages part: a stencil has masters,
// not drawing pages.)
const DOCUMENT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>' +
  "</Relationships>";

// A stencil window rather than a drawing window.
const WINDOWS_XML =
  XML_DECL +
  '<Windows xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">' +
  '<Window ID="0" WindowType="Stencil" WindowState="1073741824"/>' +
  "</Windows>";

const CORE_XML =
  XML_DECL +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  "<dc:creator>OpenDeviceIO</dc:creator><cp:lastModifiedBy>OpenDeviceIO</cp:lastModifiedBy>" +
  "</cp:coreProperties>";

const APP_XML =
  XML_DECL +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
  "<Application>OpenDeviceIO adapters</Application></Properties>";

// --- Master geometry (inches; Visio's default page units) -------------------
const SHAPE_W = 2.2; // master rectangle width
const PORT_ROW = 0.28; // vertical pitch between port rows
const TITLE_BAND = 0.45; // height reserved for the title band
const PAD = 0.25;

function shapeHeight(termCount: number): number {
  return TITLE_BAND + Math.max(termCount, 1) * PORT_ROW + PAD;
}

/**
 * Build the <MasterContents> XML for one device master. The single <Shape> is a
 * rectangle (LocPin at its centre) carrying the device title + port labels as
 * text, and one connection point per physical connector. Inputs land on the
 * left edge, outputs/bidirectional on the right edge, evenly spaced by Y, each
 * with a Prompt cell naming the port.
 */
function masterContentsXml(view: DeviceView): { xml: string; height: number; portCount: number } {
  const terms = expandConnectors(view);
  const h = shapeHeight(terms.length);

  const parts: string[] = [];
  parts.push(XML_DECL);
  parts.push(
    '<MasterContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">'
  );
  parts.push("<Shapes>");
  parts.push(`<Shape ID="1" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`);
  // Shape transform: pin at the rectangle centre.
  parts.push(`<Cell N="PinX" V="${(SHAPE_W / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="PinY" V="${(h / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="Width" V="${SHAPE_W.toFixed(4)}"/>`);
  parts.push(`<Cell N="Height" V="${h.toFixed(4)}"/>`);
  parts.push(`<Cell N="LocPinX" V="${(SHAPE_W / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="LocPinY" V="${(h / 2).toFixed(4)}"/>`);
  // Rectangle geometry (closed path).
  parts.push(
    '<Section N="Geometry" IX="0">' +
      '<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/>' +
      '<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>' +
      `<Row T="LineTo" IX="2"><Cell N="X" V="${SHAPE_W.toFixed(4)}"/><Cell N="Y" V="0"/></Row>` +
      `<Row T="LineTo" IX="3"><Cell N="X" V="${SHAPE_W.toFixed(4)}"/><Cell N="Y" V="${h.toFixed(4)}"/></Row>` +
      `<Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="${h.toFixed(4)}"/></Row>` +
      '<Row T="LineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>' +
      "</Section>"
  );
  // Connection points: one per physical connector. N attribute values per the
  // Visio XML reference (Connection Row): X, Y, DirX, DirY, Type, Prompt.
  // Type=0 = inward connection point. The Prompt names the port for identification.
  if (terms.length > 0) {
    parts.push('<Section N="Connection">');
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      // Even Y distribution down the rectangle body (below the title band).
      const y = h - TITLE_BAND - (i + 0.5) * PORT_ROW;
      const onLeft = t.direction === "input";
      const x = onLeft ? 0 : SHAPE_W;
      const dirX = onLeft ? -1 : 1; // alignment vector points outward from the edge
      parts.push(
        `<Row IX="${i + 1}">` +
          `<Cell N="X" V="${x.toFixed(4)}"/>` +
          `<Cell N="Y" V="${y.toFixed(4)}"/>` +
          `<Cell N="DirX" V="${dirX}"/>` +
          `<Cell N="DirY" V="0"/>` +
          `<Cell N="Type" V="0"/>` +
          `<Cell N="Prompt" V="${xml(t.label)}" U="STR"/>` +
          "</Row>"
      );
    }
    parts.push("</Section>");
  }
  // Shape text: title on the first line, one port label per following line.
  const lines = [deviceTitle(view.device)];
  for (const t of terms) lines.push(`${t.label} (${portTypeLabel(t)})`);
  parts.push(`<Text>${xml(lines.join("\n"))}</Text>`);
  parts.push("</Shape>");
  parts.push("</Shapes>");
  parts.push("</MasterContents>");

  return { xml: parts.join(""), height: h, portCount: terms.length };
}

/**
 * Build a simple text-only master for a cable (no connector geometry). Cables in
 * ODIO are bodies, not port-bearing devices, so they become a labelled box
 * master with no connection points. (Design choice: a cable is still draggable
 * as a master so the stencil documents it, but it is not a wiring terminal.)
 */
function cableMasterContentsXml(label: string): { xml: string } {
  const w = 3.0;
  const h = 0.4;
  const parts: string[] = [];
  parts.push(XML_DECL);
  parts.push(
    '<MasterContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">'
  );
  parts.push("<Shapes>");
  parts.push(`<Shape ID="1" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`);
  parts.push(`<Cell N="PinX" V="${(w / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="PinY" V="${(h / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="Width" V="${w.toFixed(4)}"/>`);
  parts.push(`<Cell N="Height" V="${h.toFixed(4)}"/>`);
  parts.push(`<Cell N="LocPinX" V="${(w / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="LocPinY" V="${(h / 2).toFixed(4)}"/>`);
  parts.push(
    '<Section N="Geometry" IX="0">' +
      '<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/>' +
      '<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>' +
      `<Row T="LineTo" IX="2"><Cell N="X" V="${w.toFixed(4)}"/><Cell N="Y" V="0"/></Row>` +
      `<Row T="LineTo" IX="3"><Cell N="X" V="${w.toFixed(4)}"/><Cell N="Y" V="${h.toFixed(4)}"/></Row>` +
      `<Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="${h.toFixed(4)}"/></Row>` +
      '<Row T="LineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>' +
      "</Section>"
  );
  parts.push(`<Text>${xml(label)}</Text>`);
  parts.push("</Shape>");
  parts.push("</Shapes>");
  parts.push("</MasterContents>");
  return { xml: parts.join("") };
}

/** One master, accumulated before serialisation into masters.xml + master#.xml. */
interface MasterEntry {
  /** 1-based master index; drives master<index>.xml and the rels rId. */
  index: number;
  /** Visio Master ID (== index here). */
  id: number;
  /** Master NameU/Name shown in the stencil pane. */
  name: string;
  /** The master#.xml body. */
  contents: string;
}

function buildMastersXml(entries: MasterEntry[]): string {
  const masters: string[] = [];
  for (const e of entries) {
    // Each <Master> references its master#.xml part via <Rel r:id>. The Rel id
    // maps to masters.xml.rels below (rId<index>).
    masters.push(
      `<Master ID="${e.id}" NameU="${xml(e.name)}" Name="${xml(e.name)}" ` +
        `IconUpdate="0" MatchByName="0" Hidden="0" MasterType="0">` +
        `<Rel r:id="rId${e.index}"/>` +
        "</Master>"
    );
  }
  return (
    XML_DECL +
    '<Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">' +
    masters.join("") +
    "</Masters>"
  );
}

function buildMastersRels(entries: MasterEntry[]): string {
  const rels: string[] = [];
  for (const e of entries) {
    rels.push(
      `<Relationship Id="rId${e.index}" ` +
        'Type="http://schemas.microsoft.com/visio/2010/relationships/master" ' +
        `Target="master${e.index}.xml"/>`
    );
  }
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.join("") +
    "</Relationships>"
  );
}

function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device"
  );
}

function cableLabel(cable: CableBody, qty: number): string {
  const mfr = cable.manufacturer ?? "";
  const model = cable.model ?? cable.sku ?? cable.label ?? "cable";
  const base = `${mfr} ${model}`.trim();
  const q = qty > 1 ? ` x${qty}` : "";
  return `Cable: ${base}${q}`;
}

/**
 * The Microsoft Visio adapter. Validates the input via the SDK, then builds a
 * STENCIL (.vssx) OPC zip with one MASTER shape per device — a labelled
 * rectangle with one connection point per physical connector. For a bundle,
 * one master is emitted per leaf device; cables become simple text-only masters
 * (no connection points). Returns binary `bytes`.
 */
export const VisioAdapter: Adapter = {
  id: "visio",
  label: "Microsoft Visio (stencil of masters)",
  fileExtension: "vssx",

  export(device: OdioDevice): AdapterResult {
    const routed = validateDocument(device);
    if (!routed.valid) {
      throw new Error(
        `Visio adapter: input is not a valid OpenDeviceIO ${routed.kind} document:\n${formatErrors(
          routed.errors
        )}`
      );
    }

    const warnings: string[] = [];
    const masters: MasterEntry[] = [];
    let fileBase: string;

    const usedNames = new Set<string>();
    const addDeviceMaster = (view: DeviceView) => {
      const { xml: contents } = masterContentsXml(view);
      let name = deviceTitle(view.device);
      // Disambiguate duplicate names (e.g. multiple identical leaf devices).
      if (usedNames.has(name)) {
        let n = 2;
        while (usedNames.has(`${name} (${n})`)) n++;
        name = `${name} (${n})`;
      }
      usedNames.add(name);
      const index = masters.length + 1;
      masters.push({ index, id: index, name, contents });
    };
    const addCableMaster = (label: string) => {
      const { xml: contents } = cableMasterContentsXml(label);
      let name = label;
      if (usedNames.has(name)) {
        let n = 2;
        while (usedNames.has(`${name} (${n})`)) n++;
        name = `${name} (${n})`;
      }
      usedNames.add(name);
      const index = masters.length + 1;
      masters.push({ index, id: index, name, contents });
    };

    if (routed.kind === "bundle") {
      const bundle = device as unknown as Bundle;
      const flat = flattenBundle(bundle);
      for (const entry of flat.devices) {
        const view = entry.device as FlattenedDevice;
        if (!view.device?.manufacturer || !view.device?.model) {
          warnings.push(
            `Bundle leaf "${entry.path.join(" / ")}": device missing manufacturer/model; skipped.`
          );
          continue;
        }
        const qty = entry.quantity >= 1 ? entry.quantity : 1;
        for (let unit = 1; unit <= qty; unit++) {
          addDeviceMaster({ device: view.device, ports: view.ports });
        }
      }
      for (const entry of flat.cables) {
        addCableMaster(cableLabel(entry.cable as CableBody, entry.quantity));
      }
      for (const ref of flat.unresolvedRefs) {
        warnings.push(`Unresolved ${ref.type} reference at "${ref.path.join(" / ")}"; not rendered.`);
      }
      if (masters.length === 0) {
        throw new Error("Visio adapter: bundle expanded to zero masters.");
      }
      fileBase = fileSlug(`${bundle.bundle?.manufacturer ?? ""}-${bundle.bundle?.model ?? "bundle"}`);
    } else if (routed.kind === "cable") {
      const cable = (device as unknown as { cable: CableBody }).cable;
      addCableMaster(cableLabel(cable, 1));
      fileBase = fileSlug(`${cable.manufacturer ?? ""}-${cable.model ?? cable.label ?? "cable"}`);
    } else {
      const view = device as DeviceView;
      if (!view.device?.manufacturer || !view.device?.model) {
        throw new Error("Visio adapter: device must have a non-empty manufacturer and model.");
      }
      addDeviceMaster(view);
      fileBase = fileSlug(`${view.device.manufacturer}-${view.device.model}`);
    }

    // Assemble the OPC stencil package. fflate's zipSync is synchronous,
    // matching the synchronous Adapter contract.
    const pkg: Zippable = {
      "[Content_Types].xml": strToU8(buildContentTypes(masters.length)),
      "_rels/.rels": strToU8(ROOT_RELS),
      "docProps/core.xml": strToU8(CORE_XML),
      "docProps/app.xml": strToU8(APP_XML),
      "visio/document.xml": strToU8(DOCUMENT_XML),
      "visio/_rels/document.xml.rels": strToU8(DOCUMENT_RELS),
      "visio/masters/masters.xml": strToU8(buildMastersXml(masters)),
      "visio/masters/_rels/masters.xml.rels": strToU8(buildMastersRels(masters)),
      "visio/windows.xml": strToU8(WINDOWS_XML)
    };
    for (const e of masters) {
      pkg[`visio/masters/master${e.index}.xml`] = strToU8(e.contents);
    }
    const bytes = zipSync(pkg, { level: 6 });

    return {
      files: [{ path: `${fileBase}.vssx`, bytes }],
      warnings
    };
  }
};
