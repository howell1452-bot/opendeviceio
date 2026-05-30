import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import {
  listMyMemberships,
  listMyAccessRequests
} from "@/lib/membership";
import { supabaseConfigured } from "@/lib/supabase-server";
import { AccessRequestForm } from "./AccessRequestForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contribute as a manufacturer",
  description:
    "Manufacturer reps: request access to publish manufacturer-verified .odio.json files for your brand on OpenDeviceIO."
};

export default async function ContributePage() {
  const configured = supabaseConfigured();
  const { user, client } = await getCurrentUser();

  const memberships = user && client ? await listMyMemberships(client) : [];
  const requests = user && client ? await listMyAccessRequests(client) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
        For manufacturers
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Contribute as a manufacturer
      </h1>
      <p className="mt-3 text-slate-600">
        OpenDeviceIO lets the brands that make AV hardware publish authoritative{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
          .odio.json
        </code>{" "}
        device, bundle, and cable files for their own products. Approved reps
        upload files for their brand and they go live as{" "}
        <strong>manufacturer-verified</strong> in the public{" "}
        <Link className="text-brand-700 underline" href="/registry">
          registry and in your device resource downloads.
        </Link>
        .
      </p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-base font-semibold text-slate-900">
          Why publish your products to OpenDeviceIO
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          One accurate file makes your gear effortless to design with and adopt —
          and ends the guesswork about what&apos;s really on the back panel.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          <li>
            <strong className="text-slate-900">Designed in faster.</strong>{" "}
            Integrators, engineers, and consultants import your devices straight
            into their CAD and schematic tools — accurate connectors, signals,
            power, and kits, with no re-keying from spec sheets.
          </li>
          <li>
            <strong className="text-slate-900">Adopted more.</strong> When your
            product drops cleanly into a design, it&apos;s far likelier to be
            specified and to land in the bill of materials.
          </li>
          <li>
            <strong className="text-slate-900">Ground truth, from you.</strong>{" "}
            A manufacturer-verified file is the authoritative source — it
            disambiguates the conflicting, out-of-date, and hand-keyed data
            scattered across every design tool&apos;s product library.
          </li>
          <li>
            <strong className="text-slate-900">
              Fewer errors &amp; support tickets.
            </strong>{" "}
            Correct I/O up front means fewer wiring mistakes and fewer
            &ldquo;which port does what?&rdquo; questions for the engineers and
            end users who build around your gear.
          </li>
        </ul>
      </section>

      {!configured ? (
        <Notice tone="amber">
          Contribution is not configured on this deployment yet.
        </Notice>
      ) : !user ? (
        <Notice tone="brand">
          <Link className="font-semibold underline" href="/signin">
            Sign in
          </Link>{" "}
          with your work email to request access for your brand.
        </Notice>
      ) : (
        <>
          {memberships.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">
                Your approved brands
              </h2>
              <ul className="mt-3 space-y-2">
                {memberships.map((m) => (
                  <li
                    key={m.manufacturer}
                    className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
                  >
                    <span className="font-medium text-emerald-900">
                      {m.manufacturer}
                    </span>
                    <Link
                      href="/publish"
                      className="text-sm font-medium text-emerald-800 underline"
                    >
                      Publish a file →
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-slate-600">
                Two ways to publish for your brand:{" "}
                <Link className="text-brand-700 underline" href="/publish">
                  upload an .odio file
                </Link>
                , or{" "}
                <Link className="text-brand-700 underline" href="/author">
                  author one from a form
                </Link>{" "}
                with a live preview and publish it directly.
              </p>
            </section>
          ) : null}

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">
              Request access for a brand
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Signed in as <strong>{user.email}</strong>. Submit the exact
              manufacturer name you want to publish for. An OpenDeviceIO admin
              reviews each request.
            </p>
            <div className="mt-4">
              <AccessRequestForm email={user.email ?? ""} />
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-slate-900">
              Your requests
            </h2>
            {requests.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No access requests yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">
                        {r.manufacturer}
                      </div>
                      {r.note ? (
                        <div className="truncate text-sm text-slate-500">
                          {r.note}
                        </div>
                      ) : null}
                    </div>
                    <RequestStatus status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function RequestStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 ring-amber-200",
    approved: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    rejected: "bg-red-100 text-red-700 ring-red-200"
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        map[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
    >
      {status}
    </span>
  );
}

function Notice({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: "amber" | "brand";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-brand-200 bg-brand-50 text-brand-900";
  return (
    <div className={`mt-8 rounded-lg border p-4 text-sm ${cls}`}>{children}</div>
  );
}
