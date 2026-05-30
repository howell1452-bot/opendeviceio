// Microsoft Visio adapter (target "visio", emits a .vssx STENCIL).
//
// This adapter produces a Visio 2013+ STENCIL (.vssx), NOT a drawing (.vsdx).
// A stencil is an OPC (Open Packaging Conventions) ZIP package whose content is
// a collection of MASTER shapes — the draggable blocks that appear in Visio's
// "Shapes" stencil pane. Each ODIO device becomes one master that renders like
// an EasySchematic block: a labeled rectangle with one CONNECTION POINT per
// physical connector, so a user can drag the master onto a page and wire cables
// to the green connection points.
//
// GROUND-TRUTH TEMPLATING
// -----------------------
// The previous hand-built .vssx failed in real Visio with "Error 271". This
// rewrite is templated directly from a REAL Extron Visio stencil
// (references/visio/DTP - CrossPoint 4K Eng.vssx). The package now carries the
// FULL part set that a pristine Visio writes — including the parts the v1 omitted
// (docProps/{app,core,custom}.xml, visio/pages/pages.xml, the document StyleSheets
// machinery, the master PageSheet) — which is what makes Visio accept the file.
//
// OPC package layout (stencil), matching the reference exactly:
//
//   [Content_Types].xml                         — part content-type registry
//   _rels/.rels                                 — package root relationships
//   docProps/core.xml, app.xml, custom.xml      — document properties
//   visio/document.xml                          — VisioDocument (StyleSheets etc.)
//   visio/_rels/document.xml.rels               — document -> masters + pages + windows
//   visio/pages/pages.xml                       — a (single, empty) drawing page
//   visio/masters/masters.xml                   — <Masters> index (one <Master> each)
//   visio/masters/_rels/masters.xml.rels        — masters index -> each master#.xml
//   visio/masters/master1.xml ... masterN.xml   — one <MasterContents> per device
//   visio/windows.xml                           — window state
//
// REPLICATED FROM THE REAL MASTERS (so output opens in Visio AND renders on drop):
//   * <Master> attribute set: IsCustomNameU/IsCustomName, Prompt, IconSize,
//     AlignName, MatchByName, IconUpdate='1', UniqueID, BaseID, PatternFlags,
//     Hidden, MasterType='2', a <PageSheet> sized to the shape, an <Icon> bitmap,
//     and <Rel r:id>.
//   * The master content is a single top-level <Shape Type='Shape'> that — exactly
//     like a real master's root shape — carries a NameU/Name (IsCustomNameU/
//     IsCustomName), the full placement cell set (PinX/PinY/Width/Height/LocPinX/
//     LocPinY/Angle/FlipX/FlipY/ResizeMode), a drawn rectangle <Section N='Geometry'>,
//     a <Section N='Character'> + <Section N='Paragraph'> with a <Text> block using
//     the <cp/><pp/> run markers, and the <Section N='Connection'> (one Row per
//     physical connector). This is the canonical minimal renderable master.
//
// WHY THIS FIXES "Error 313 — the master is empty":
//   The previous version made the root shape a Type='Group' with NO NameU/Name and
//   delegated all geometry to an (also unnamed) child shape. A master whose root
//   shape has no name and no geometry of its own is treated by Visio as empty on
//   drop. We now emit a single named shape that draws its own rectangle, so Visio
//   always has renderable geometry to instantiate.
//
// SIMPLIFIED vs the real masters (intentional, noted for Visio verification):
//   * One labelled rectangle per device (the real Extron masters draw the full
//     faceplate with dozens of nested sub-shapes). Ports become text lines +
//     connection points rather than individually drawn jacks.
//   * A tiny generic <Icon> (a framed-box 32x32 4bpp bitmap) is shipped for every
//     master, matching the fact that real masters always carry an <Icon>. We also
//     set IconUpdate='1' so Visio regenerates the preview from the geometry.
//   * Cell geometry formulas (F='Width*..') are omitted; we emit resolved literals
//     (Visio reads the V value), but each Geometry/placement row carries the same
//     cell NAMES the real shapes use.

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
import { DOCUMENT_XML, PAGES_XML, WINDOWS_XML } from "./visio-template.js";

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

// --- Deterministic GUIDs ----------------------------------------------------
//
// Visio masters carry a UniqueID and a BaseID (GUIDs). They must be stable per
// device (no Date.now/Math.random) so repeated exports of the same input are
// byte-identical. We derive a GUID deterministically from a string seed via a
// small FNV-1a hash expanded into 16 bytes formatted as a GUID. The exact value
// is irrelevant to Visio as long as it is a well-formed, distinct GUID.

function fnv1a(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Build a deterministic, well-formed GUID string from a seed. */
function deterministicGuid(seed: string): string {
  // Expand the seed into 16 bytes by hashing four salted variants.
  const bytes: number[] = [];
  for (let block = 0; block < 4; block++) {
    const h = fnv1a(`${block}:${seed}`);
    bytes.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  const g = hex.join("").toUpperCase();
  return `{${g.slice(0, 8)}-${g.slice(8, 12)}-${g.slice(12, 16)}-${g.slice(16, 20)}-${g.slice(20, 32)}}`;
}

// --- Static OPC parts -------------------------------------------------------
//
// Content-type Overrides matching the reference stencil EXACTLY: the document
// part uses ".stencil." so the package is recognised as a .vssx, plus masters,
// each master#, pages, windows and the three docProps parts.

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
    '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.stencil.main+xml"/>' +
    '<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>' +
    masterOverrides.join("") +
    '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>' +
    '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' +
    "</Types>"
  );
}

// Package root relationships — same relationship types/targets as the reference.
const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>' +
  "</Relationships>";

// Document relationships: masters + pages + windows (the reference includes a
// pages relationship even though a stencil's page is empty).
const DOCUMENT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>' +
  "</Relationships>";

const CORE_XML =
  XML_DECL +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  "<dc:title>OpenDeviceIO Stencil</dc:title><dc:subject></dc:subject>" +
  "<dc:creator>OpenDeviceIO</dc:creator><cp:keywords></cp:keywords><dc:description></dc:description>" +
  "<cp:lastModifiedBy>OpenDeviceIO</cp:lastModifiedBy><cp:category></cp:category><dc:language>en-US</dc:language>" +
  "</cp:coreProperties>";

// docProps/app.xml — genericised. The HeadingPairs/TitlesOfParts vectors are
// populated per-export with the master names so the counts stay consistent with
// the reference's app.xml shape (Pages + Masters heading pairs).
function buildAppXml(masterNames: string[]): string {
  const titleEntries = ["<vt:lpstr>Page-1</vt:lpstr>"]
    .concat(masterNames.map((n) => `<vt:lpstr>${xml(n)}</vt:lpstr>`))
    .join("");
  const titlesSize = masterNames.length + 1;
  return (
    XML_DECL +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    "<Template></Template><TotalTime>0</TotalTime><Application>OpenDeviceIO adapters</Application>" +
    "<ScaleCrop>false</ScaleCrop>" +
    '<HeadingPairs><vt:vector size="4" baseType="variant">' +
    "<vt:variant><vt:lpstr>Pages</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant>" +
    `<vt:variant><vt:lpstr>Masters</vt:lpstr></vt:variant><vt:variant><vt:i4>${masterNames.length}</vt:i4></vt:variant>` +
    "</vt:vector></HeadingPairs>" +
    `<TitlesOfParts><vt:vector size="${titlesSize}" baseType="lpstr">${titleEntries}</vt:vector></TitlesOfParts>` +
    "<Manager></Manager><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>" +
    "<HyperlinkBase></HyperlinkBase><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>" +
    "</Properties>"
  );
}

// docProps/custom.xml — the reference carries Visio's private build/metric props.
// Replicated with neutral fixed values (IsMetric=false matches our inch units).
const CUSTOM_XML =
  XML_DECL +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
  'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
  '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="_VPID_ALTERNATENAMES"><vt:lpwstr></vt:lpwstr></property>' +
  '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="BuildNumberCreated"><vt:i4>1074147066</vt:i4></property>' +
  '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="BuildNumberEdited"><vt:i4>1075461591</vt:i4></property>' +
  '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="5" name="IsMetric"><vt:bool>false</vt:bool></property>' +
  "</Properties>";

// A valid 32x32 4bpp ICO bitmap (a framed device box), lifted verbatim from the
// ground-truth reference stencil. Every real master carries an <Icon>; shipping
// one — rather than relying on IconUpdate alone — keeps the master from being
// treated as empty and gives a sensible stencil-pane preview. The same generic
// frame is used for all masters (IconUpdate='1' lets Visio refine it on load).
const MASTER_ICON =
  "AAABAAEAICAQLwAAAADoAgAAFgAAACgAAAAgAAAAQAAAAAEABAAAAAAAgAIAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAACAAACAAAAAgIAAgAAAAIAAgACAgAAAgICAAMDAwAAAAP8AAP8AAAD//wD/AAAA\n" +
  "/wD/AP//AAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
  "AAAAAAAAAAAAAAD/////////////////5+f//+PH///hx///4e///+H////h////4f///+H////j\n" +
  "////4f///+P////h////4f///+HH///jx///4Yf//+HH///jx///4Yf//+HH///hh///4cf//+HH\n" +
  "///jh///4Af//+dn///wB///8A///////w==";

// --- Master geometry (inches; Visio's default page units) -------------------
const SHAPE_W = 2.25; // master rectangle width (matches the reference ~2.25in)
const PORT_ROW = 0.28; // vertical pitch between port rows
const TITLE_BAND = 0.5; // height reserved for the title band
const PAD = 0.25;

function shapeHeight(termCount: number): number {
  return TITLE_BAND + Math.max(termCount, 1) * PORT_ROW + PAD;
}

/**
 * Emit a fully-formed top-level <Shape Type='Shape'> for one master. This is the
 * single building block both device and cable masters use, and it mirrors a real
 * master's root shape so Visio always has renderable geometry on drop:
 *   * NameU/Name (IsCustomNameU/IsCustomName) — a master's root shape MUST be named,
 *     otherwise Visio reports "Error 313 — the master is empty";
 *   * the full placement cell set (PinX/PinY/Width/Height/LocPinX/LocPinY/Angle/
 *     FlipX/FlipY/ResizeMode);
 *   * a drawn rectangle <Section N='Geometry'> (closed MoveTo/LineTo path) carrying
 *     the same NoFill/NoLine/NoShow/NoSnap/NoQuickDrag cells the real shapes use;
 *   * a <Section N='Character'> + <Section N='Paragraph'> and a <Text> block with
 *     the <cp/><pp/> run markers (so the text actually renders);
 *   * the <Section N='Connection'> (one Row per physical connector) when provided.
 * The shape references the document's Normal style (Line/Fill/Text style 3), which
 * is defined in document.xml with a visible black hairline + solid fill.
 */
function shapeXml(opts: {
  id: number;
  name: string;
  width: number;
  height: number;
  text: string;
  connectors?: ExpandedConnector[];
}): string {
  const { id, name, width: w, height: h, text } = opts;
  const uid = deterministicGuid(`shape:${id}:${name}`);
  const nm = xml(name);
  const parts: string[] = [];
  parts.push(
    `<Shape ID='${id}' NameU='${nm}' IsCustomNameU='1' Name='${nm}' IsCustomName='1' ` +
      `Type='Shape' LineStyle='3' FillStyle='3' TextStyle='3' UniqueID='${uid}'>`
  );
  parts.push(`<Cell N='PinX' V='${(w / 2).toFixed(6)}'/>`);
  parts.push(`<Cell N='PinY' V='${(h / 2).toFixed(6)}'/>`);
  parts.push(`<Cell N='Width' V='${w.toFixed(6)}'/>`);
  parts.push(`<Cell N='Height' V='${h.toFixed(6)}'/>`);
  parts.push(`<Cell N='LocPinX' V='${(w / 2).toFixed(6)}'/>`);
  parts.push(`<Cell N='LocPinY' V='${(h / 2).toFixed(6)}'/>`);
  parts.push("<Cell N='Angle' V='0'/>");
  parts.push("<Cell N='FlipX' V='0'/>");
  parts.push("<Cell N='FlipY' V='0'/>");
  parts.push("<Cell N='ResizeMode' V='0'/>");

  // Connection points: one Row per physical connector (T='Connection', IX from 0,
  // matching the reference). Inputs on the left edge (X=0), outputs/bidirectional
  // on the right edge (X=Width). DirX/DirY=0 as in the reference masters.
  const terms = opts.connectors ?? [];
  if (terms.length > 0) {
    parts.push("<Section N='Connection'>");
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      const y = h - TITLE_BAND - (i + 0.5) * PORT_ROW;
      const onLeft = t.direction === "input";
      const x = onLeft ? 0 : w;
      parts.push(
        `<Row T='Connection' IX='${i}'>` +
          `<Cell N='X' V='${x.toFixed(6)}'/>` +
          `<Cell N='Y' V='${y.toFixed(6)}'/>` +
          `<Cell N='DirX' V='0'/>` +
          `<Cell N='DirY' V='0'/>` +
          `<Cell N='Type' V='0'/>` +
          `<Cell N='AutoGen' V='0'/>` +
          `<Cell N='Prompt' V='${xml(t.label)}'/>` +
          "</Row>"
      );
    }
    parts.push("</Section>");
  }

  // Character + Paragraph sections so the <Text> run (referenced by <cp/>/<pp/>)
  // has a defined font/colour/alignment — matching how real text shapes render.
  parts.push(
    "<Section N='Character'><Row IX='0'>" +
      "<Cell N='Font' V='Arial'/><Cell N='Color' V='#000000'/><Cell N='Size' V='0.1111111111111111'/>" +
      "</Row></Section>"
  );
  parts.push(
    "<Section N='Paragraph'><Row IX='0'><Cell N='HorzAlign' V='1'/></Row></Section>"
  );

  // Rectangle geometry (closed path), matching the reference's Geometry cell set.
  parts.push(
    "<Section N='Geometry' IX='0'>" +
      "<Cell N='NoFill' V='0'/><Cell N='NoLine' V='0'/><Cell N='NoShow' V='0'/>" +
      "<Cell N='NoSnap' V='0'/><Cell N='NoQuickDrag' V='0'/>" +
      "<Row T='MoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>" +
      `<Row T='LineTo' IX='2'><Cell N='X' V='${w.toFixed(6)}'/><Cell N='Y' V='0'/></Row>` +
      `<Row T='LineTo' IX='3'><Cell N='X' V='${w.toFixed(6)}'/><Cell N='Y' V='${h.toFixed(6)}'/></Row>` +
      `<Row T='LineTo' IX='4'><Cell N='X' V='0'/><Cell N='Y' V='${h.toFixed(6)}'/></Row>` +
      "<Row T='LineTo' IX='5'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>" +
      "</Section>"
  );
  // Shape text: the <cp/>/<pp/> markers reference the Character/Paragraph rows.
  parts.push(`<Text><cp IX='0'/><pp IX='0'/>${xml(text)}</Text>`);
  parts.push("</Shape>");
  return parts.join("");
}

/** Wrap one or more top-level shapes in a <MasterContents> document. */
function masterContentsDoc(shapesXml: string): string {
  return (
    XML_DECL.trimEnd() +
    "\n" +
    "<MasterContents xmlns='http://schemas.microsoft.com/office/visio/2012/main' " +
    "xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships' xml:space='preserve'>" +
    "<Shapes>" +
    shapesXml +
    "</Shapes></MasterContents>"
  );
}

/**
 * Build the <MasterContents> XML for one device master: a single labelled
 * rectangle carrying one connection point per physical connector and a text
 * block (device title + one line per port).
 */
function masterContentsXml(view: DeviceView): { xml: string; width: number; height: number } {
  const terms = expandConnectors(view);
  const h = shapeHeight(terms.length);
  const w = SHAPE_W;
  const title = deviceTitle(view.device);
  const lines = [title];
  for (const t of terms) lines.push(`${t.label} (${portTypeLabel(t)})`);
  const shape = shapeXml({
    id: 1,
    name: title,
    width: w,
    height: h,
    text: lines.join("\n"),
    connectors: terms
  });
  return { xml: masterContentsDoc(shape), width: w, height: h };
}

/**
 * Build a text-only master for a cable (no connector geometry). Cables in ODIO
 * are bodies, not port-bearing devices, so they become a labelled box master
 * (a Group with a single rectangle child, no connection points).
 */
function cableMasterContentsXml(label: string): { xml: string; width: number; height: number } {
  const w = 3.0;
  const h = 0.5;
  const shape = shapeXml({ id: 1, name: label, width: w, height: h, text: label });
  return { xml: masterContentsDoc(shape), width: w, height: h };
}

/** One master, accumulated before serialisation into masters.xml + master#.xml. */
interface MasterEntry {
  /** 1-based master index; drives master<index>.xml and the rels rId. */
  index: number;
  /** Visio Master ID. */
  id: number;
  /** Master NameU/Name shown in the stencil pane. */
  name: string;
  /** The master#.xml body. */
  contents: string;
  /** Master page width (inches). */
  width: number;
  /** Master page height (inches). */
  height: number;
}

// masters.xml — replicates the reference <Master> attribute set + a PageSheet
// sized to the shape + a Layer section + an <Icon> + the <Rel>, in the reference's
// element order (PageSheet, Icon, Rel). Each master ships the generic frame icon
// and also sets IconUpdate='1' so Visio refines the preview on load.
function masterXml(e: MasterEntry): string {
  const uniqueId = deterministicGuid(`unique:${e.index}:${e.name}`);
  const baseId = deterministicGuid(`base:${e.index}:${e.name}`);
  return (
    `<Master ID='${e.id}' NameU='${xml(e.name)}' IsCustomNameU='1' Name='${xml(e.name)}' IsCustomName='1' ` +
    `Prompt='' IconSize='1' AlignName='2' MatchByName='0' IconUpdate='1' ` +
    `UniqueID='${uniqueId}' BaseID='${baseId}' PatternFlags='0' Hidden='0' MasterType='2'>` +
    `<PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>` +
    `<Cell N='PageWidth' V='${e.width.toFixed(6)}'/>` +
    `<Cell N='PageHeight' V='${e.height.toFixed(6)}'/>` +
    `<Cell N='ShdwOffsetX' V='0.125'/><Cell N='ShdwOffsetY' V='-0.125'/>` +
    `<Cell N='PageScale' V='1' U='IN_F'/><Cell N='DrawingScale' V='1' U='IN_F'/>` +
    `<Cell N='DrawingSizeType' V='4'/><Cell N='DrawingScaleType' V='0'/><Cell N='InhibitSnap' V='0'/>` +
    `<Cell N='PageLockReplace' V='0' U='BOOL'/><Cell N='PageLockDuplicate' V='0' U='BOOL'/>` +
    `<Cell N='UIVisibility' V='0'/><Cell N='ShdwType' V='0'/><Cell N='ShdwObliqueAngle' V='0'/>` +
    `<Cell N='ShdwScaleFactor' V='1'/><Cell N='DrawingResizeType' V='1'/>` +
    `<Section N='Layer'><Row IX='0'>` +
    `<Cell N='Name' V='0'/><Cell N='Color' V='#000000'/><Cell N='Status' V='0'/><Cell N='Visible' V='1'/>` +
    `<Cell N='Print' V='1'/><Cell N='Active' V='0'/><Cell N='Lock' V='0'/><Cell N='Snap' V='1'/>` +
    `<Cell N='Glue' V='1'/><Cell N='NameUniv' V='0'/><Cell N='ColorTrans' V='0'/>` +
    `</Row></Section>` +
    `</PageSheet>` +
    `<Icon>\n${MASTER_ICON}</Icon>` +
    `<Rel r:id='rId${e.index}'/>` +
    `</Master>`
  );
}

function buildMastersXml(entries: MasterEntry[]): string {
  return (
    "<?xml version='1.0' encoding='utf-8' ?>\r\n" +
    "<Masters xmlns='http://schemas.microsoft.com/office/visio/2012/main' " +
    "xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships' xml:space='preserve'>" +
    entries.map(masterXml).join("") +
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
 * rectangle (Group) with one connection point per physical connector. For a
 * bundle, one master is emitted per leaf device; cables become text-only
 * masters. Returns binary `bytes`.
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
    const uniqueName = (base: string): string => {
      let name = base;
      if (usedNames.has(name)) {
        let n = 2;
        while (usedNames.has(`${name} (${n})`)) n++;
        name = `${name} (${n})`;
      }
      usedNames.add(name);
      return name;
    };
    const addDeviceMaster = (view: DeviceView) => {
      const { xml: contents, width, height } = masterContentsXml(view);
      const name = uniqueName(deviceTitle(view.device));
      const index = masters.length + 1;
      masters.push({ index, id: index, name, contents, width, height });
    };
    const addCableMaster = (label: string) => {
      const { xml: contents, width, height } = cableMasterContentsXml(label);
      const name = uniqueName(label);
      const index = masters.length + 1;
      masters.push({ index, id: index, name, contents, width, height });
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

    // Assemble the OPC stencil package, matching the reference part set exactly.
    const pkg: Zippable = {
      "[Content_Types].xml": strToU8(buildContentTypes(masters.length)),
      "_rels/.rels": strToU8(ROOT_RELS),
      "docProps/core.xml": strToU8(CORE_XML),
      "docProps/app.xml": strToU8(buildAppXml(masters.map((m) => m.name))),
      "docProps/custom.xml": strToU8(CUSTOM_XML),
      "visio/document.xml": strToU8(DOCUMENT_XML),
      "visio/_rels/document.xml.rels": strToU8(DOCUMENT_RELS),
      "visio/pages/pages.xml": strToU8(PAGES_XML),
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
