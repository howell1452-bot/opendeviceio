"use client";

import { useState } from "react";
import Link from "next/link";
import { validateDocument, type OdioDocument } from "@opendeviceio/sdk";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import {
  deriveRegistryRow,
  documentManufacturer,
  stampManufacturerVerified
} from "@/lib/odio-row";

type Result =
  | { kind: "ok"; id: string }
  | { kind: "error"; message: string; details?: string[] };

export function PublishForm({ brands }: { brands: string[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      await publishText(text);
    } catch (err) {
      setResult({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Could not read the file."
      });
    } finally {
      setBusy(false);
    }
  }

  async function publishText(text: string) {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setResult({ kind: "error", message: "Supabase is not configured." });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setResult({ kind: "error", message: "File is not valid JSON." });
      return;
    }

    const validation = validateDocument(parsed);
    if (!validation.valid) {
      setResult({
        kind: "error",
        message: "Document failed ODIO schema validation.",
        details: validation.errors.map((e) =>
          e.path ? `${e.path}: ${e.message}` : e.message
        )
      });
      return;
    }

    const doc = parsed as OdioDocument;
    const manufacturer = documentManufacturer(doc);
    if (!manufacturer) {
      setResult({
        kind: "error",
        message:
          "The document does not name a manufacturer (device.manufacturer / bundle.manufacturer / cable.manufacturer)."
      });
      return;
    }
    if (!brands.includes(manufacturer)) {
      setResult({
        kind: "error",
        message: `This document's manufacturer "${manufacturer}" is not one of your approved brands (${brands.join(
          ", "
        )}). You can only publish files for your own brand.`
      });
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email ?? "unknown";

    const stamped = stampManufacturerVerified(doc, email);
    const row = deriveRegistryRow(stamped, validation.kind);
    if (!row.id) {
      setResult({ kind: "error", message: "The document has no id." });
      return;
    }
    row.validation_status = "manufacturer-verified";

    // RLS enforces that the caller may only upsert rows whose manufacturer is
    // in their memberships, so this fails server-side for any other brand.
    const { error } = await supabase.from("registry").upsert(
      {
        id: row.id,
        kind: row.kind,
        manufacturer: row.manufacturer,
        model: row.model,
        category: row.category,
        product_line: row.product_line,
        sku: row.sku,
        validation_status: "manufacturer-verified",
        odio_version: row.odio_version,
        port_count: row.port_count,
        connectors: row.connectors,
        transports: row.transports,
        document: row.document
      },
      { onConflict: "id" }
    );

    if (error) {
      setResult({
        kind: "error",
        message: `Publish failed: ${error.message}`
      });
      return;
    }
    setResult({ kind: "ok", id: row.id });
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragOver
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 bg-slate-50 hover:border-brand-300"
        }`}
      >
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <span className="font-medium text-slate-700">
          {busy ? "Publishing…" : "Drop a .odio.json file here, or click to choose"}
        </span>
        {fileName ? (
          <span className="mt-1 text-sm text-slate-500">{fileName}</span>
        ) : null}
      </label>

      {result?.kind === "ok" ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Published as <strong>manufacturer-verified</strong>. View it at{" "}
          <Link
            className="font-mono font-semibold underline"
            href={`/registry/${result.id}`}
          >
            /registry/{result.id}
          </Link>
          .
        </div>
      ) : null}

      {result?.kind === "error" ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">{result.message}</p>
          {result.details && result.details.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
              {result.details.slice(0, 20).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
