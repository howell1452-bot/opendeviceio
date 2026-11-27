import Link from "next/link";
import { AuthNav } from "./AuthNav";
import { MobileNav } from "./MobileNav";

export const NAV = [
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/guide", label: "Authoring guide" },
  { href: "/registry", label: "Registry" },
  { href: "/tools", label: "Tools" },
  { href: "/manufacturers", label: "For Manufacturers" },
  { href: "/implement", label: "For Design Software Vendors" },
  { href: "/schema/v0.1/device.schema.json", label: "Schema" },
  { href: "/about", label: "About" }
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-bold text-slate-900"
        >
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 font-mono text-sm text-white">
            IO
          </span>
          <span className="text-lg tracking-tight">
            OpenDevice<span className="text-brand-600">IO</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {/* Full nav on wide screens; a Menu dropdown below that. */}
          <nav className="hidden items-center gap-0.5 text-sm xl:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" />
          </nav>
          <div className="text-sm">
            <AuthNav />
          </div>
          <MobileNav items={NAV} />
        </div>
      </div>
    </header>
  );
}
