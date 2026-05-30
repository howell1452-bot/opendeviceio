import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="max-w-sm">
            <div className="font-bold text-slate-900">
              OpenDevice<span className="text-brand-600">IO</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              An open, machine-readable format for describing hardware device I/O,
              power, physical, and compliance characteristics.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm">
            <div>
              <div className="font-semibold text-slate-900">Docs</div>
              <ul className="mt-2 space-y-1.5 text-slate-600">
                <li><Link className="hover:text-brand-700" href="/whitepaper">Whitepaper</Link></li>
                <li><Link className="hover:text-brand-700" href="/guide">Authoring guide</Link></li>
                <li><Link className="hover:text-brand-700" href="/implement">Implement ODIO</Link></li>
                <li><Link className="hover:text-brand-700" href="/api-docs">API reference</Link></li>
                <li><Link className="hover:text-brand-700" href="/registry">Registry</Link></li>
                <li><Link className="hover:text-brand-700" href="/contribute">Contribute (manufacturers)</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Schema v0.1</div>
              <ul className="mt-2 space-y-1.5 text-slate-600">
                <li><a className="hover:text-brand-700" href="/schema/v0.1/device.schema.json">device</a></li>
                <li><a className="hover:text-brand-700" href="/schema/v0.1/bundle.schema.json">bundle</a></li>
                <li><a className="hover:text-brand-700" href="/schema/v0.1/cable.schema.json">cable</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-1 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:justify-between">
          <span>Code &amp; schema: Apache-2.0 · Spec &amp; docs: CC BY 4.0</span>
          <span>ODIO format version 0.1.0</span>
        </div>
      </div>
    </footer>
  );
}
