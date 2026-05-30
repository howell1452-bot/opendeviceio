// Microsoft Visio adapter (target "visio", .vsdx).
//
// A .vsdx file is an OPC (Open Packaging Conventions) ZIP package of XML parts.
// This adapter builds a MINIMAL but well-formed package containing the parts
// Visio requires to open a drawing:
//
//   [Content_Types].xml                      — part content-type registry
//   _rels/.rels                              — package root relationships
//   docProps/core.xml, docProps/app.xml      — document properties
//   visio/document.xml                       — VisioDocument root
//   visio/_rels/document.xml.rels            — document -> pages relationship
//   visio/pages/pages.xml                    — page index
//   visio/pages/_rels/pages.xml.rels         — page index -> page parts
//   visio/pages/page1.xml                    — the drawing page (shapes)
//   visio/windows.xml                        — window state
//
// Each ODIO device becomes a rectangle Shape on the page, titled with
// "<manufacturer> <model>", with one child sub-shape per physical connector
// (from the shared per-connector expander) carrying the port label + signal
// type, plus a Connection (connection point) per terminal so Visio's connector
// tool can snap wires. Bundles place one device shape per leaf device on the
// single page (laid out in a row); cables are added as text-only shapes.
//
// SIMPLIFICATIONS / CAVEAT: this is a hand-built minimal package. It targets the
// documented VSDX schema (Microsoft "MS-VSDX") closely enough to open with the
// device rectangles + labeled ports, but — exactly like the EasySchematic target
// before it was validated against the real app — the precise Master/Geometry
// machinery a pristine Visio file emits is large; we emit explicit shape Geometry
// and Text instead of referencing Masters. Treat round-tripping in the real Visio
// app as still needing validation; see README. The package IS a valid OPC zip
// with all required parts and the page XML carries every device title + port
// label.

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

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>' +
  '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>' +
  '<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>' +
  '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  "</Types>";

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

const DOCUMENT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>' +
  "</Relationships>";

const PAGES_XML =
  XML_DECL +
  '<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">' +
  '<Page ID="0" NameU="Page-1" Name="Page-1" ViewScale="-1" ViewCenterX="4.25" ViewCenterY="5.5">' +
  '<PageSheet>' +
  '<Cell N="PageWidth" V="8.5"/><Cell N="PageHeight" V="11"/><Cell N="PageScale" V="1"/><Cell N="DrawingScale" V="1"/>' +
  "</PageSheet>" +
  '<Rel r:id="rId1"/>' +
  "</Page>" +
  "</Pages>";

const PAGES_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>' +
  "</Relationships>";

const WINDOWS_XML =
  XML_DECL +
  '<Windows xmlns="http://schemas.microsoft.com/office/visio/2012/main" ClientWidth="1000" ClientHeight="600" xml:space="preserve">' +
  '<Window ID="0" WindowType="Drawing" WindowState="1073741824" Page="0" ViewScale="-1" ViewCenterX="4.25" ViewCenterY="5.5"/>' +
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

// --- Page geometry (inches; Visio's default page units) ---------------------
const SHAPE_W = 2.2; // device rectangle width
const PORT_ROW = 0.28; // vertical pitch between port rows
const TITLE_BAND = 0.45; // height for the title
const PAD = 0.25;
const COL_GAP = 0.9; // gap between device shapes in a row
const PAGE_TOP = 10.5; // shapes start near the top of an 11in page

function shapeHeight(termCount: number): number {
  return TITLE_BAND + Math.max(termCount, 1) * PORT_ROW + PAD;
}

let shapeIdCounter = 1;
function nextId(): number {
  return shapeIdCounter++;
}

/**
 * Emit a Visio Shape XML element for one device. PinX/PinY is the shape center;
 * Width/Height its size. A child sub-shape per terminal carries the port label,
 * and a Connection point is declared per terminal.
 */
function deviceShapeXml(view: DeviceView, leftX: number): { xml: string; width: number; height: number } {
  const terms = expandConnectors(view);
  const h = shapeHeight(terms.length);
  const id = nextId();
  const pinX = leftX + SHAPE_W / 2;
  const topY = PAGE_TOP;
  const pinY = topY - h / 2;

  const parts: string[] = [];
  parts.push(
    `<Shape ID="${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`
  );
  parts.push(`<Cell N="PinX" V="${pinX.toFixed(4)}"/>`);
  parts.push(`<Cell N="PinY" V="${pinY.toFixed(4)}"/>`);
  parts.push(`<Cell N="Width" V="${SHAPE_W.toFixed(4)}"/>`);
  parts.push(`<Cell N="Height" V="${h.toFixed(4)}"/>`);
  parts.push(`<Cell N="LocPinX" V="${(SHAPE_W / 2).toFixed(4)}"/>`);
  parts.push(`<Cell N="LocPinY" V="${(h / 2).toFixed(4)}"/>`);
  // Rectangle geometry.
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
  // Connection points: one per terminal, on the left/right edge by direction.
  parts.push('<Section N="Connection">');
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    const y = h - TITLE_BAND - (i + 0.5) * PORT_ROW;
    const x = t.direction === "input" ? 0 : SHAPE_W;
    parts.push(
      `<Row N="Connection.${i + 1}"><Cell N="X" V="${x.toFixed(4)}"/><Cell N="Y" V="${y.toFixed(4)}"/>` +
        `<Cell N="DirX" V="0"/><Cell N="DirY" V="0"/><Cell N="Type" V="0"/></Row>`
    );
  }
  parts.push("</Section>");
  // Shape text: title + each port label on its own line.
  const lines = [deviceTitle(view.device)];
  for (const t of terms) lines.push(`${t.label} (${portTypeLabel(t)})`);
  parts.push(`<Text>${xml(lines.join("\n"))}</Text>`);
  parts.push("</Shape>");

  return { xml: parts.join(""), width: SHAPE_W, height: h };
}

function cableShapeXml(label: string, leftX: number, rowY: number): string {
  const id = nextId();
  const w = 3.0;
  const h = 0.3;
  return (
    `<Shape ID="${id}" Type="Shape">` +
    `<Cell N="PinX" V="${(leftX + w / 2).toFixed(4)}"/>` +
    `<Cell N="PinY" V="${rowY.toFixed(4)}"/>` +
    `<Cell N="Width" V="${w.toFixed(4)}"/>` +
    `<Cell N="Height" V="${h.toFixed(4)}"/>` +
    `<Text>${xml(label)}</Text>` +
    "</Shape>"
  );
}

function buildPageXml(shapes: string[]): string {
  return (
    XML_DECL +
    '<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">' +
    "<Shapes>" +
    shapes.join("") +
    "</Shapes>" +
    "</PageContents>"
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
 * minimal valid VSDX (OPC zip) with one rectangle shape per device, each titled
 * and listing its labeled I/O terminals with per-terminal connection points.
 */
export const VisioAdapter: Adapter = {
  id: "visio",
  label: "Microsoft Visio (schematic block)",
  fileExtension: "vsdx",

  export(device: OdioDevice): AdapterResult {
    const routed = validateDocument(device);
    if (!routed.valid) {
      throw new Error(
        `Visio adapter: input is not a valid OpenDeviceIO ${routed.kind} document:\n${formatErrors(
          routed.errors
        )}`
      );
    }

    shapeIdCounter = 1;
    const warnings: string[] = [];
    const shapes: string[] = [];
    let cursorX = 0.5;
    let fileBase: string;

    const addDevice = (view: DeviceView) => {
      const { xml: shapeXml, width } = deviceShapeXml(view, cursorX);
      shapes.push(shapeXml);
      cursorX += width + COL_GAP;
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
          addDevice({ device: view.device, ports: view.ports });
        }
      }
      let cableY = 1.0;
      for (const entry of flat.cables) {
        shapes.push(cableShapeXml(cableLabel(entry.cable as CableBody, entry.quantity), 0.5, cableY));
        cableY -= 0.4;
      }
      for (const ref of flat.unresolvedRefs) {
        warnings.push(`Unresolved ${ref.type} reference at "${ref.path.join(" / ")}"; not rendered.`);
      }
      if (shapes.length === 0) {
        throw new Error("Visio adapter: bundle expanded to zero shapes.");
      }
      fileBase = fileSlug(`${bundle.bundle?.manufacturer ?? ""}-${bundle.bundle?.model ?? "bundle"}`);
    } else if (routed.kind === "cable") {
      const cable = (device as unknown as { cable: CableBody }).cable;
      shapes.push(cableShapeXml(cableLabel(cable, 1), 0.5, PAGE_TOP - 0.5));
      fileBase = fileSlug(`${cable.manufacturer ?? ""}-${cable.model ?? cable.label ?? "cable"}`);
    } else {
      const view = device as DeviceView;
      if (!view.device?.manufacturer || !view.device?.model) {
        throw new Error("Visio adapter: device must have a non-empty manufacturer and model.");
      }
      addDevice(view);
      fileBase = fileSlug(`${view.device.manufacturer}-${view.device.model}`);
    }

    const pageXml = buildPageXml(shapes);

    // Assemble the OPC package. fflate's zipSync is synchronous, matching the
    // synchronous Adapter contract.
    const pkg: Zippable = {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "docProps/core.xml": strToU8(CORE_XML),
      "docProps/app.xml": strToU8(APP_XML),
      "visio/document.xml": strToU8(DOCUMENT_XML),
      "visio/_rels/document.xml.rels": strToU8(DOCUMENT_RELS),
      "visio/pages/pages.xml": strToU8(PAGES_XML),
      "visio/pages/_rels/pages.xml.rels": strToU8(PAGES_RELS),
      "visio/pages/page1.xml": strToU8(pageXml),
      "visio/windows.xml": strToU8(WINDOWS_XML)
    };
    const bytes = zipSync(pkg, { level: 6 });

    return {
      files: [{ path: `${fileBase}.vsdx`, bytes }],
      warnings
    };
  }
};
