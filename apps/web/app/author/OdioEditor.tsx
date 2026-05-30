"use client";

import { useMemo, useState } from "react";
import { validate } from "@opendeviceio/sdk";
import { buildIoTable, renderTableSvg } from "@opendeviceio/adapters";

// Lossless .odio editor: edit the raw document JSON (so no field is dropped), with
// live validation + I/O-table preview, and a gated "Publish update" that upserts via
// POST /api/v1/devices (server re-checks brand scope). Used to fix/update an existing
// registry device for an approved brand, and as the advanced/edit mode of /author.

function manufacturerOf(doc: unknown): string {
  const d = doc as { device?: { manufacturer?: string }; bundle?: { manufacturer?: string }; cable?: { manufacturer?: string } };
  return (d?.device?.manufacturer ?? d?.bundle?.manufacturer ?? d?.cable?.manufacturer ?? "").trim();
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function OdioEditor({
  initialJson,
  signedIn = false,
  brands = []
}: {
  initialJson: string;
  signedIn?: boolean;
  brands?: string[];
}) {
  const [text, setText] = useState(initialJson);
  const [publishState, setPublishState] = useState<{ status: "idle" | "busy" | "ok" | "error"; message?: string }>({ status: "idle" });

  const { doc, parseError, errors, svg } = useMemo(() => {
    let doc: unknown = null;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return { doc: null, parseError: e instanceof Error ? e.message : String(e), errors: [] as string[], svg: null as string | null };
    }
    let errors: string[] = [];
    try {
      const r = validate(doc as never);
      errors = r.valid ? [] : r.errors.map((e) => `${e.path || "(root)"}: ${e.message}`);
    } catch (e) {
      errors = [e instanceof Error ? e.message : String(e)];
    }
    let svg: string | null = null;
    if (errors.length === 0) {
      try {
        svg = renderTableSvg(buildIoTable(doc as never)).replace(/^<\?xml[^>]*\?>\s*/, "");
      } catch {
        svg = null;
      }
    }
    return { doc, parseError: null as string | null, errors, svg };
  }, [text]);

  const mfr = doc ? manufacturerOf(doc) : "";
  const brandOk = mfr.length > 0 && brands.includes(mfr);
  const docId = (doc as { id?: string } | null)?.id;
  const canPublish = signedIn && !parseError && errors.length === 0 && brandOk && publishState.status !== "busy";

  const publish = async () => {
    setPublishState({ status: "busy" });
    try {
      const res = await fetch("/api/v1/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: text
      });
      if (res.ok) setPublishState({ status: "ok", message: String(docId ?? "") });
      else {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setPublishState({ status: "error", message: e.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setPublishState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <label className="block text-xs font-medium text-slate-500">.odio document (JSON)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="mt-1 h-[28rem] w-full rounded-lg border border-slate-300 p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => download(`${(docId ?? "device").replace(/[^a-z0-9]+/gi, "-")}.odio`, text, "application/vnd.odio+json")}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-400"
          >
            Download .odio
          </button>
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        {parseError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <strong className="font-semibold">JSON error:</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">{parseError}</pre>
          </div>
        ) : errors.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong className="font-semibold">{errors.length} schema issue(s):</strong>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Valid ODIO document.
          </div>
        )}

        <div className="mt-3">
          {signedIn ? (
            <>
              <button
                onClick={publish}
                disabled={!canPublish}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-emerald-700 disabled:opacity-40"
              >
                {publishState.status === "busy" ? "Publishing…" : "Publish update"}
              </button>
              {!parseError && errors.length === 0 && !brandOk ? (
                <p className="mt-2 text-xs text-amber-700">
                  Your account isn&apos;t approved to publish for{" "}
                  <strong>{mfr || "(no manufacturer)"}</strong>. Approved:{" "}
                  {brands.length ? brands.join(", ") : "none"}.
                </p>
              ) : null}
              {publishState.status === "ok" ? (
                <p className="mt-2 text-xs text-emerald-700">
                  Updated <code className="font-mono">{publishState.message}</code> —{" "}
                  <a className="underline" href={`/registry/${publishState.message}`}>
                    view in registry
                  </a>
                  .
                </p>
              ) : null}
              {publishState.status === "error" ? (
                <p className="mt-2 text-xs text-red-700">Publish failed: {publishState.message}</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-slate-500">
              <a className="underline" href="/contribute">
                Sign in as a manufacturer
              </a>{" "}
              to publish updates, or download the edited file.
            </p>
          )}
        </div>

        {svg ? (
          <div
            className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>
    </div>
  );
}
