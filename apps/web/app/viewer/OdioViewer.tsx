"use client";

import { useCallback, useRef, useState } from "react";
import { buildIoTable, renderTableSvg, renderTableHtml } from "@opendeviceio/adapters";

// Client-side ODIO viewer: drop or open an .odio file (or paste JSON) and render
// the standardized I/O table. Everything runs in the browser via the adapters
// package — no upload, nothing leaves the page.

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "device";
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

export function OdioViewer() {
  const [svg, setSvg] = useState<string | null>(null);
  const [doc, setDoc] = useState<unknown>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback((text: string) => {
    try {
      const parsed = JSON.parse(text) as Parameters<typeof buildIoTable>[0];
      const table = buildIoTable(parsed);
      setSvg(renderTableSvg(table).replace(/^<\?xml[^>]*\?>\s*/, ""));
      setDoc(parsed);
      setTitle(table.title);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSvg(null);
      setDoc(null);
      setTitle("");
    }
  }, []);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f) f.text().then(load);
    },
    [load]
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50"
        }`}
      >
        <p className="text-slate-600">
          Drop an <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code>{" "}
          file here, or
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Choose a file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".odio,.json,application/json,application/vnd.odio+json"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <p className="mt-3 text-xs text-slate-400">
          Runs entirely in your browser — the file is never uploaded.
        </p>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong className="font-semibold">Couldn&apos;t render this file.</strong>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{error}</pre>
        </div>
      ) : null}

      {svg ? (
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => download(`${slugify(title)}.io-table.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, "image/svg+xml")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
              >
                Download SVG
              </button>
              <button
                onClick={() => doc && download(`${slugify(title)}.io-table.html`, renderTableHtml(doc as Parameters<typeof renderTableHtml>[0]), "text/html")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
              >
                Download HTML
              </button>
            </div>
          </div>
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            // The SVG is produced by our own adapter from the parsed document.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </section>
      ) : null}
    </div>
  );
}
