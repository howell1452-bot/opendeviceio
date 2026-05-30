import type { Metadata } from "next";
import { OdioAuthor } from "./OdioAuthor";

export const metadata: Metadata = {
  title: "Author an .odio file",
  description:
    "Create a valid OpenDeviceIO (.odio) device file from a simple form — identity, ports, signals, and power — with a live I/O-table preview. No JSON by hand; nothing is uploaded."
};

export default function AuthorPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Tools</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Author an .odio file</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Describe a device&apos;s I/O once and get a validated{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code> file plus
        the standardized I/O table — no JSON by hand. Everything runs in your browser; nothing is
        uploaded. Manufacturers: this is the fastest way to publish a device (or hand the file to
        your spec-sheet layout).
      </p>

      <div className="mt-8">
        <OdioAuthor />
      </div>
    </div>
  );
}
