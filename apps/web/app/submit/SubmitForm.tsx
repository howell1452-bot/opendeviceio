"use client";

import { useMemo, useState } from "react";
import { normalizeManufacturer, validateDocument } from "@opendeviceio/sdk";
import { SubmitToRegistry, type SubmitOrg } from "@/components/SubmitToRegistry";
import { claimedValidationStatus } from "@/lib/submission-doc";
import { statusLabel } from "@/components/Badge";

/** Upload or paste a .odio file, check it in the browser, then submit it. */
export function SubmitForm({ orgs, brands }: { orgs: SubmitOrg[]; brands: string[] }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const check = useMemo(() => {
    if (!text.trim()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return {
        doc: null,
        errors: [`This isn't a valid .odio file: JSON syntax error (${e instanceof Error ? e.message : String(e)}).`]
      };
    }
    const v = validateDocument(parsed);
    if (!v.valid) {
      return {
        doc: null,
        errors: v.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
      };
    }
    return { doc: parsed, errors: [] as string[] };
  }, [text]);

  const doc = check?.doc ?? null;
  const id = (doc as { id?: string } | null)?.id ?? null;
  const d = doc as {
    device?: { manufacturer?: string };
    bundle?: { manufacturer?: string };
    cable?: { manufacturer?: string };
  } | null;
  const rawMfr = d?.device?.manufacturer ?? d?.bundle?.manufacturer ?? d?.cable?.manufacturer ?? "";
  const mfr = rawMfr ? normalizeManufacturer(rawMfr) ?? rawMfr : "";
  const ownBrand = mfr !== "" && brands.map((b) => normalizeManufacturer(b) ?? b).includes(mfr);
  const claimed = doc ? claimedValidationStatus(doc) : null;

  async function readFile(file: File) {
    setFileName(file.name);
    setText(await file.text());
  }

  return (
    <div className="space-y-6">
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
          if (file) void readFile(file);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-brand-300"
        }`}
      >
        <input
          type="file"
          accept=".odio,.odio.json,.json,application/json,application/vnd.odio+json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = "";
          }}
        />
        <span className="font-medium text-slate-700">Drop a .odio file here, or click to choose</span>
        {fileName ? <span className="mt-1 text-sm text-slate-500">{fileName}</span> : null}
      </label>

      <label className="block text-xs font-medium text-slate-600">
        …or paste the .odio source (JSON syntax)
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
          spellCheck={false}
          rows={10}
          className="mt-1 block w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          placeholder='{ "odioVersion": "0.1.0", "id": "manufacturer/model", ... }'
        />
      </label>

      {check && check.errors.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">The file doesn&apos;t pass ODIO schema validation.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
            {check.errors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {doc ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            ✓ Valid ODIO document <span className="font-mono">{id}</span>
            {mfr ? <> for {mfr}</> : null}.
          </p>
          {claimed && claimed !== "draft" ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The file says it is <strong>{statusLabel(claimed).toLowerCase()}</strong>. The
              registry ignores that and stores it as an unverified draft; only the
              manufacturer can verify a record.
            </p>
          ) : null}
          {ownBrand ? (
            <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              You&apos;re a verified publisher for {mfr}.{" "}
              <a className="underline" href="/publish">
                Publish it as manufacturer-verified
              </a>{" "}
              instead.
            </p>
          ) : (
            <div className="mt-4">
              <SubmitToRegistry document={doc} orgs={orgs} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
