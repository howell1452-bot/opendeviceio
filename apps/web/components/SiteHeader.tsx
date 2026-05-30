import Link from "next/link";
import { AuthNav } from "./AuthNav";

const NAV = [
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/guide", label: "Authoring guide" },
  { href: "/implement", label: "Implement" },
  { href: "/registry", label: "Registry" },
  { href: "/contribute", label: "Contribute" },
  { href: "/schema/v0.1/device.schema.json", label: "Schema" }
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 font-mono text-sm text-white">
            IO
          </span>
          <span className="text-lg tracking-tight">
            OpenDevice<span className="text-brand-600">IO</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:px-3"
            >
              {item.label}
            </Link>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline-block" />
          <AuthNav />
        </nav>
      </div>
    </header>
  );
}
