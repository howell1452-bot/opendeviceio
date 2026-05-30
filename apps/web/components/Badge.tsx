import type { ReactNode } from "react";

const KIND_STYLES: Record<string, string> = {
  device: "bg-brand-100 text-brand-800 ring-brand-200",
  bundle: "bg-violet-100 text-violet-800 ring-violet-200",
  cable: "bg-amber-100 text-amber-800 ring-amber-200"
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  reviewed: "bg-sky-100 text-sky-800 ring-sky-200",
  "manufacturer-verified": "bg-emerald-100 text-emerald-800 ring-emerald-200"
};

function Pill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <Pill className={KIND_STYLES[kind] ?? "bg-slate-100 text-slate-700 ring-slate-200"}>
      {kind}
    </Pill>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <Pill className={STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}>
      {status}
    </Pill>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
      {children}
    </span>
  );
}
