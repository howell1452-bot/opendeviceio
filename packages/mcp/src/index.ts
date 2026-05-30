#!/usr/bin/env node
// OpenDeviceIO MCP server.
//
// Exposes the OpenDeviceIO registry to AI agents (Claude et al.) as Model Context
// Protocol tools, so a design assistant works from validated ground truth instead of
// hallucinating device I/O:
//   - search_devices : find devices/bundles/cables in the registry
//   - get_device     : fetch a full .odio document by id
//   - get_io_table   : the standardized I/O-table model for a device (render-ready)
//   - validate_design: validate a proposed .odio document (schema + modular-chassis
//                       slot fit) via the SDK — the "generate -> validate -> repair" loop
//
// Search/fetch hit the public REST API (ODIO_API_BASE, default https://opendeviceio.org);
// validation runs locally via @opendeviceio/sdk. Transport: stdio.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateDocument, validateChassis } from "@opendeviceio/sdk";

const API_BASE = (process.env.ODIO_API_BASE ?? "https://opendeviceio.org").replace(/\/+$/, "");

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}
function errorText(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

async function api(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ODIO API ${res.status} for ${path}`);
  return res.json();
}

const server = new McpServer({ name: "opendeviceio", version: "0.1.0" });

server.tool(
  "search_devices",
  "Search the OpenDeviceIO registry for devices, bundles, and cables. Returns matching entries (id, manufacturer, model, category, kind, validation status). Use the id with get_device / get_io_table.",
  {
    q: z.string().optional().describe("Free-text match on manufacturer / model / id."),
    manufacturer: z.string().optional().describe("Exact manufacturer name, e.g. 'Crestron'."),
    category: z.string().optional().describe("Dotted category, e.g. 'av/switcher/matrix'."),
    kind: z.enum(["device", "bundle", "cable"]).optional(),
    connector: z.string().optional().describe("Connector vocab value present on the device, e.g. 'hdmi-type-a'."),
    limit: z.number().int().min(1).max(200).optional().describe("Max results (default 25).")
  },
  async (args) => {
    try {
      const sp = new URLSearchParams();
      if (args.q) sp.set("q", args.q);
      if (args.manufacturer) sp.set("manufacturer", args.manufacturer);
      if (args.category) sp.set("category", args.category);
      if (args.kind) sp.set("kind", args.kind);
      if (args.connector) sp.set("connector", args.connector);
      sp.set("limit", String(args.limit ?? 25));
      const data = (await api(`/api/v1/devices?${sp.toString()}`)) as { data?: unknown[]; total?: number };
      return text({ total: data.total, count: data.data?.length ?? 0, results: data.data ?? [] });
    } catch (e) {
      return errorText(e instanceof Error ? e.message : String(e));
    }
  }
);

server.tool(
  "get_device",
  "Fetch the full .odio document (the ground-truth device/bundle/cable data) for a registry id, e.g. 'crestron/dm-nvx-360'.",
  { id: z.string().describe("Registry id, e.g. 'crestron/dm-nvx-360'.") },
  async ({ id }) => {
    try {
      return text(await api(`/api/v1/devices/${encodeURIComponent(id)}`));
    } catch (e) {
      return errorText(e instanceof Error ? e.message : String(e));
    }
  }
);

server.tool(
  "get_io_table",
  "Get the standardized I/O table for a device id: rows grouped Input/Output/Bidirectional/Power with connector, link, and signals — a compact, render-ready summary of the device's I/O.",
  { id: z.string().describe("Registry id, e.g. 'crestron/dm-nvx-360'.") },
  async ({ id }) => {
    try {
      return text(await api(`/api/v1/devices/${encodeURIComponent(id)}?format=table`));
    } catch (e) {
      return errorText(e instanceof Error ? e.message : String(e));
    }
  }
);

server.tool(
  "validate_design",
  "Validate a proposed ODIO document (device, bundle, or cable) against the schema, and for a bundle also check modular-chassis slot assignments (card fit, occupancy, power budget). Use this to verify an AI-proposed device/design before trusting it — returns valid:true or the concrete errors to repair.",
  { document: z.record(z.any()).describe("The ODIO document to validate, as a JSON object.") },
  async ({ document }) => {
    try {
      const result = validateDocument(document as never);
      const out: Record<string, unknown> = {
        valid: result.valid,
        kind: result.kind,
        errors: result.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
      };
      if (result.kind === "bundle") {
        const issues = validateChassis(document as never);
        out.chassisIssues = issues.map((i) => `${i.path.join(" / ")}: ${i.message}`);
      }
      return text(out);
    } catch (e) {
      return errorText(e instanceof Error ? e.message : String(e));
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("odio-mcp failed to start:", e);
  process.exit(1);
});
