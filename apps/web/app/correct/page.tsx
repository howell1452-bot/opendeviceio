import type { Metadata } from "next";
import Link from "next/link";
import { getRegistryRow } from "@/lib/registry";
import { StatusBadge } from "@/components/Badge";
import { CONTACT_EMAIL } from "@/lib/project";
import { REMOVAL_REQUEST_BUSINESS_DAYS } from "@/lib/data-license";
import { RecordRequestForm } from "./RecordRequestForm";
import type { RequestType } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Correct or remove a record",
  description:
    "Manufacturers and anyone else can ask for a registry record to be corrected, removed, or verified. No sign-up needed."
};

function list(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
}

export default async function CorrectPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ids = list(sp.id)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const typeParam = list(sp.type)[0];
  const initialType: RequestType =
    typeParam === "removal" || typeParam === "verify" ? typeParam : "correction";

  const rows = (await Promise.all(ids.map((id) => getRegistryRow(id)))).filter(
    (r): r is NonNullable<typeof r> => Boolean(r)
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
        Registry records
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Correct, remove, or verify a record
      </h1>
      <p className="mt-3 text-slate-600">
        Most records in the registry are unverified drafts, machine-extracted
        from manufacturers&apos; public documents. If one is about your product,
        you can ask us to fix it, take it down, or let you verify it. No
        account is needed.
      </p>

      {rows.length > 0 ? (
        <ul className="mt-6 space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-900">
                  {[r.manufacturer, r.model].filter(Boolean).join(" ")}
                </div>
                <Link
                  href={`/registry/${r.id}`}
                  className="font-mono text-xs text-brand-700 underline"
                >
                  {r.id}
                </Link>
              </div>
              <StatusBadge status={r.validation_status} />
            </li>
          ))}
        </ul>
      ) : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <Option title="Correct it">
          Tell us what&apos;s wrong and what it should say. We fix the record
          and note the change. Once you&apos;ve claimed your brand you can
          make corrections yourself.
        </Option>
        <Option title="Remove it">
          We take the record down within{" "}
          <strong>{REMOVAL_REQUEST_BUSINESS_DAYS} business days</strong> and list
          it in the public{" "}
          <Link className="text-brand-700 underline" href="/api-docs#removals">
            removal feed
          </Link>{" "}
          so tools that copied it delete it too.
        </Option>
        <Option title="Verify it">
          Manufacturers can claim their brand and publish their own
          records, which replace the drafts and show as{" "}
          <strong>manufacturer-verified</strong>.{" "}
          <Link className="text-brand-700 underline" href="/manufacturers#verification">
            How it works
          </Link>
          .
        </Option>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">Send a request</h2>
        <p className="mt-1 text-sm text-slate-600">
          We reply by email. Removal requests are completed within{" "}
          {REMOVAL_REQUEST_BUSINESS_DAYS} business days.
        </p>
        <div className="mt-5">
          <RecordRequestForm
            initialIds={rows.length ? rows.map((r) => r.id).join("\n") : ids.join("\n")}
            initialType={initialType}
            contactEmail={CONTACT_EMAIL}
          />
        </div>
      </section>
    </div>
  );
}

function Option({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{children}</p>
    </div>
  );
}
