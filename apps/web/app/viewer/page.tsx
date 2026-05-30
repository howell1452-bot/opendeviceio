import type { Metadata } from "next";
import { OdioViewer } from "./OdioViewer";

export const metadata: Metadata = {
  title: "ODIO viewer — see a device's I/O at a glance",
  description:
    "Open an .odio file in your browser to view its standardized I/O table — connectors, links, signals, and power — and export it as SVG or a self-contained HTML page."
};

export default function ViewerPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Tools</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">ODIO viewer</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Open an{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code> file to
        see its standardized <strong>I/O table</strong> — one row per physical connector, grouped by
        direction, with the link, signals, and power. The table is a deterministic projection of the
        file, so it always matches the data. Export it as SVG for a spec sheet, or as a
        self-contained HTML page you can share.
      </p>

      <div className="mt-8">
        <OdioViewer />
      </div>
    </div>
  );
}
