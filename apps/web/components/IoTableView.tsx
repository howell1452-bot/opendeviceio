import type { OdioDevice } from "@opendeviceio/sdk";
import { buildIoTable, renderTableSvg } from "@opendeviceio/adapters";

// Renders the standardized ODIO I/O table for a document (device/bundle/cable) as
// an inline SVG. The table is a deterministic projection of the document, so it
// always matches the data. Server component — rendered at request time.
export function IoTableView({ document }: { document: OdioDevice }) {
  let svg: string | null = null;
  try {
    svg = renderTableSvg(buildIoTable(document)).replace(/^<\?xml[^>]*\?>\s*/, "");
  } catch {
    svg = null;
  }
  if (!svg) return null;

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900">I/O table</h2>
      <p className="mt-1 text-sm text-slate-500">
        One row per physical connector — connector, link, the signal flows it carries, and power.
      </p>
      <div
        className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </section>
  );
}
