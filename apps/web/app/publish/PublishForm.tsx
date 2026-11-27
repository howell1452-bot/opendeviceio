"use client";

import { useState } from "react";
import Link from "next/link";
import {
  normalizeManufacturer,
  validateDocument,
  type OdioDocument
} from "@opendeviceio/sdk";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import {
  deriveRegistryRow,
  documentManufacturer,
  stampManufacturerVerified
} from "@/lib/odio-row";
import { statusLabel } from "@/components/Badge";

type Result =
  | { kind: "ok"; id: string; replaced: string | null }
  | { kind: "error"; message: string; details?: string[] };

/** A validated document waiting for the publisher to confirm. */
interface Pending {
  row: ReturnType<typeof deriveRegistryRow>;
  /** Validation status of the record this replaces, or null if new. */
  existingStatus: string | null;
  existing: boolean;
}

export function PublishForm({ brands }: { brands: string[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Memberships are stored under the canonical brand name; compare canonically.
  const canonicalBrands = brands.map((b) => normalizeManufacturer(b) ?? b);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    setPending(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      await prepare(text);
    } catch (err) {
      setResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not read the file."
      });
    } finally {
      setBusy(false);
    }
  }

  /** Validate, check brand scope, and look up the record this would replace. */
  async function prepare(text: string) {
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
    const rawManufacturer = documentManufacturer(doc);
    if (!rawManufacturer) {
      setResult({
        kind: "error",
        message:
          "The document does not name a manufacturer (device.manufacturer / bundle.manufacturer / cable.manufacturer)."
      });
      return;
    }
    const manufacturer = normalizeManufacturer(rawManufacturer) ?? rawManufacturer;
    if (!canonicalBrands.includes(manufacturer)) {
      setResult({
        kind: "error",
        message: `This document's manufacturer "${rawManufacturer}" is not one of your approved brands (${canonicalBrands.join(
          ", "
        )}). You can only publish files for your own brand.`
      });
      return;
    }

    const stamped = stampManufacturerVerified(doc, manufacturer);
    const row = deriveRegistryRow(stamped, validation.kind);
    if (!row.id) {
      setResult({ kind: "error", message: "The document has no id." });
      return;
    }
    row.validation_status = "manufacturer-verified";

    // Does this id already exist? (Members can read their brand's rows, including
    // drafts hidden from the public.)
    const { data: existingRow } = await supabase
      .from("registry")
      .select("id,validation_status")
      .eq("id", row.id)
      .maybeSingle();

    setPending({
      row,
      existing: Boolean(existingRow),
      existingStatus:
        (existingRow as { validation_status?: string | null } | null)?.validation_status ??
        null
    });
  }

  async function publish() {
    if (!pending) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { row } = pending;

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
    setBusy(false);

    if (error) {
      setResult({ kind: "error", message: `Publish failed: ${error.message}` });
      return;
    }
    setResult({
      kind: "ok",
      id: row.id,
      replaced: pending.existing ? statusLabel(pending.existingStatus) : null
    });
    setPending(null);
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
          accept=".odio,.odio.json,.json,application/json,application/vnd.odio+json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        <span className="font-medium text-slate-700">
          {busy && !pending ? "Checking…" : "Drop a .odio file here, or click to choose"}
        </span>
        {fileName ? (
          <span className="mt-1 text-sm text-slate-500">{fileName}</span>
        ) : null}
      </label>

      {pending ? (
        <div className="mt-6 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
          <p className="font-semibold">
            Ready to publish{" "}
            <span className="font-mono">{pending.row.id}</span>
          </p>
          <p className="mt-1">
            {pending.existing ? (
              <>
                This replaces the existing{" "}
                <strong>{statusLabel(pending.existingStatus).toLowerCase()}</strong>{" "}
                record with the same id. After publishing it shows as{" "}
                <strong>Manufacturer-verified</strong>, and tools that sync the
                registry pick up the change.
              </>
            ) : (
              <>
                This is a new record. It will show as{" "}
                <strong>Manufacturer-verified</strong>.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Publishing…" : "Publish as manufacturer-verified"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
              className="rounded-md px-3 py-2 font-medium text-brand-900 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {result?.kind === "ok" ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Published as <strong>manufacturer-verified</strong>
          {result.replaced ? <> (replaced the {result.replaced.toLowerCase()} record)</> : null}
          . View it at{" "}
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
