import type { ReactNode } from "react";
import { sourceLabel } from "@/lib/source";

const KIND_STYLES: Record<string, string> = {
  device: "bg-brand-100 text-brand-800 ring-brand-200",
  bundle: "bg-violet-100 text-violet-800 ring-violet-200",
  cable: "bg-amber-100 text-amber-800 ring-amber-200"
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-800 ring-amber-200",
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

/** Human-readable validation status. A missing status counts as a draft. */
export const STATUS_LABELS: Record<string, string> = {
  draft: "Unverified draft",
  reviewed: "Reviewed",
  "manufacturer-verified": "Manufacturer-verified"
};

export function statusLabel(status: string | null | undefined): string {
  return STATUS_LABELS[status ?? "draft"] ?? status ?? "Unverified draft";
}

/** True for records nobody has checked yet (draft or no status). */
export function isUnverified(status: string | null | undefined): boolean {
  return !status || status === "draft";
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "draft";
  return (
    <Pill className={STATUS_STYLES[s] ?? "bg-slate-100 text-slate-700 ring-slate-200"}>
      {statusLabel(s)}
    </Pill>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  "machine-draft": "bg-slate-100 text-slate-700 ring-slate-200",
  community: "bg-violet-50 text-violet-800 ring-violet-200",
  "design-vendor": "bg-indigo-50 text-indigo-800 ring-indigo-200",
  manufacturer: "bg-emerald-50 text-emerald-800 ring-emerald-200"
};

/**
 * Who submitted the record (separate from StatusBadge, which says who vouched
 * for it): "Machine draft", "Community submission", "Design vendor · <Org>",
 * or "Manufacturer".
 */
export function SourceBadge({
  source,
  org
}: {
  source: string | null | undefined;
  org?: string | null;
}) {
  const s = source ?? "machine-draft";
  return (
    <Pill className={SOURCE_STYLES[s] ?? SOURCE_STYLES["machine-draft"]}>
      {sourceLabel(s, org)}
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
