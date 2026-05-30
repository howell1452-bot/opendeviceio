import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tools & integrations",
  description:
    "Ways to use OpenDeviceIO: the in-browser viewer and authoring form, the AutoCAD import add-in, the TypeScript SDK, and the free public API."
};

const REPO = "https://github.com/howell1452-bot/opendeviceio";

interface Tool {
  name: string;
  tag: string;
  description: string;
  href: string;
  cta: string;
  external?: boolean;
  note?: string;
}

const WEB_TOOLS: Tool[] = [
  {
    name: "ODIO viewer",
    tag: "In browser",
    description:
      "Drop an .odio file and instantly see its standardized I/O table. Export SVG or a self-contained HTML page. Nothing is uploaded.",
    href: "/viewer",
    cta: "Open the viewer"
  },
  {
    name: "Author an .odio",
    tag: "In browser",
    description:
      "Build a valid .odio device file from a form — identity, ports, signals, power — with a live I/O-table preview. The fastest way to publish a device.",
    href: "/author",
    cta: "Start authoring"
  }
];

const INTEGRATIONS: Tool[] = [
  {
    name: "AutoCAD import add-in",
    tag: "Developer preview",
    description:
      "Adds the ODIOIMPORT command to AutoCAD (2018–2024): enter a device id and it draws the schematic block into your drawing, fetched live from the API. Source + build/install instructions on GitHub.",
    href: `${REPO}/tree/main/integrations/autocad`,
    cta: "Get it on GitHub",
    external: true,
    note: "Source scaffold (.NET Framework 4.8) — build in Visual Studio against your AutoCAD. A signed release will follow."
  },
  {
    name: "Microsoft Visio importer",
    tag: "Developer preview",
    description:
      "Draws ODIO blocks onto the active Visio page via the Visio API (no stencil files) — fetched live from the API. Same draw-instruction backend as the AutoCAD add-in.",
    href: `${REPO}/tree/main/integrations/visio`,
    cta: "Get it on GitHub",
    external: true,
    note: "Source preview (.NET Framework 4.8) — build in Visual Studio; requires Visio at run time."
  },
  {
    name: "Adobe InDesign plugin",
    tag: "Planned",
    description:
      "Place the standardized I/O table into a spec-sheet layout straight from an .odio file — author once, render onto your datasheet.",
    href: "/implement",
    cta: "Implementer guide"
  }
];

const DEV_TOOLS: Tool[] = [
  {
    name: "@opendeviceio/sdk",
    tag: "npm",
    description:
      "TypeScript SDK: generated types, an Ajv validator, bundle/chassis flattening, and the I/O-table model. The schema is the source of truth.",
    href: "https://www.npmjs.com/package/@opendeviceio/sdk",
    cta: "View on npm",
    external: true
  },
  {
    name: "@opendeviceio/adapters",
    tag: "npm",
    description:
      "Renderers/adapters: the standardized I/O table (SVG/HTML), AutoCAD DXF blocks, EasySchematic, and the host-agnostic DrawProgram the native add-ins consume.",
    href: "https://www.npmjs.com/package/@opendeviceio/adapters",
    cta: "View on npm",
    external: true
  },
  {
    name: "Public REST API",
    tag: "Free",
    description:
      "Pull any registry device by id — the raw .odio, or render-ready projections via ?format=draw (DrawProgram), table, or svg. CORS-enabled, no key.",
    href: "/implement#api",
    cta: "API guide"
  }
];

function ToolCard({ tool }: { tool: Tool }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{tool.name}</h3>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {tool.tag}
        </span>
      </div>
      <p className="mt-2 flex-1 text-sm text-slate-600">{tool.description}</p>
      {tool.note ? <p className="mt-2 text-xs text-slate-400">{tool.note}</p> : null}
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 group-hover:text-brand-900">
        {tool.cta} →
      </span>
    </>
  );
  const cls =
    "group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md";
  return tool.external ? (
    <a href={tool.href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={tool.href} className={cls}>
      {inner}
    </Link>
  );
}

function Section({ title, blurb, tools }: { title: string; blurb: string; tools: Tool[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{blurb}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <ToolCard key={t.name} tool={t} />
        ))}
      </div>
    </section>
  );
}

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Tools</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Tools &amp; integrations</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Everything for working with{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code> files —
        from the browser, your CAD/Visio/layout tools, or code.
      </p>

      <Section
        title="In the browser"
        blurb="No install — view or author .odio files right here."
        tools={WEB_TOOLS}
      />
      <Section
        title="Design-tool integrations"
        blurb="Pull devices straight into your drawing or layout."
        tools={INTEGRATIONS}
      />
      <Section
        title="For developers"
        blurb="Build ODIO into your own tools."
        tools={DEV_TOOLS}
      />
    </div>
  );
}
