import type { Metadata } from "next";
import Link from "next/link";
import { countRegistry, getFacets } from "@/lib/registry";
import { getBrandByManufacturer } from "@/lib/brands";
import { VerificationSteps } from "@/components/VerificationSteps";
import {
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  GOVERNANCE_URL,
  MAINTAINERS
} from "@/lib/project";
import { REMOVAL_REQUEST_BUSINESS_DAYS } from "@/lib/data-license";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "For manufacturers",
  description:
    "Publish your products' I/O once, as an open file every design tool can read. See your products in the registry, correct or remove a record without signing up, or claim your brand. Free, no exclusivity, no contract."
};

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Resolve a typed brand to a registry manufacturer name (case-insensitive). */
function resolveBrand(input: string, manufacturers: string[]): string | null {
  if (!input) return null;
  const q = input.toLowerCase();
  return (
    manufacturers.find((m) => m.toLowerCase() === q) ??
    manufacturers.find((m) => m.toLowerCase().startsWith(q)) ??
    manufacturers.find((m) => m.toLowerCase().includes(q)) ??
    null
  );
}

export default async function ManufacturersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const typed = first(sp.brand);
  const facets = await getFacets();
  const brand = resolveBrand(typed, facets.manufacturers);

  const [unverified, reviewed, verified] = brand
    ? await Promise.all([
        countRegistry({ manufacturer: brand, statuses: ["draft"] }),
        countRegistry({ manufacturer: brand, statuses: ["reviewed"] }),
        countRegistry({ manufacturer: brand, statuses: ["manufacturer-verified"] })
      ])
    : [null, null, null];

  const [total, totalReviewed, totalVerified] = await Promise.all([
    countRegistry(),
    countRegistry({ statuses: ["reviewed"] }),
    countRegistry({ statuses: ["manufacturer-verified"] })
  ]);

  const brandQs = brand ? `manufacturer=${encodeURIComponent(brand)}` : "";
  const brandProfile = brand ? await getBrandByManufacturer(brand) : null;

  return (
    <div>
      {/* 1. Hero */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
            For manufacturers
          </p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Publish your I/O once. Every design tool gets it right.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600">
            OpenDeviceIO is an open file format (<code className="rounded bg-white/70 px-1 font-mono text-base">.odio</code>{" "}
            files, written in JSON syntax) and a free public registry for a
            device&apos;s connectors, signals, power, and physical data. Publish
            it once, and AV and IT design tools can import it instead of
            re-keying your spec sheets by hand.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#your-products"
              className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-brand-700"
            >
              See your products
            </a>
            <Link
              href="/brands"
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-800 shadow-sm transition hover:border-brand-400"
            >
              Claim your brand
            </Link>
            <Link
              href="/correct"
              className="rounded-lg px-5 py-2.5 font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              Correct or remove a record
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-4xl space-y-16 px-4 py-14 sm:px-6">
        {/* 2. Your products today */}
        <section id="your-products" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">Your products today</h2>
          <p className="mt-2 text-slate-600">
            Most records were drafted by machine from manufacturers&apos; public
            spec sheets and haven&apos;t been reviewed yet. Search for your brand
            to see what&apos;s there.
          </p>
          <form method="get" action="/manufacturers#your-products" className="mt-5 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="brand" className="sr-only">
              Brand
            </label>
            <input
              id="brand"
              name="brand"
              list="brands"
              defaultValue={brand ?? typed}
              placeholder="Your brand, e.g. Shure"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <datalist id="brands">
              {facets.manufacturers.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700"
            >
              Show my products
            </button>
          </form>

          {typed && !brand ? (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No records for <strong>{typed}</strong> yet. If you&apos;d like your
              products in the registry, a{" "}
              <a className="text-brand-700 underline" href="#take-part">
                5-product pilot
              </a>{" "}
              is the easiest start.
            </div>
          ) : null}

          {brand ? (
            <div className="mt-5">
              <h3 className="text-lg font-semibold text-slate-900">
                {brandProfile ? (
                  <Link className="hover:text-brand-700 hover:underline" href={`/brands/${brandProfile.slug}`}>
                    {brand}
                  </Link>
                ) : (
                  brand
                )}
              </h3>
              {brandProfile ? (
                <p className="mt-1 text-sm text-slate-600">
                  {brandProfile.claimed_at ? (
                    <>Claimed by {brand}. </>
                  ) : (
                    <>
                      Unclaimed.{" "}
                      <Link className="font-medium text-brand-700 underline" href={`/brands/${brandProfile.slug}/claim`}>
                        Claim {brand}
                      </Link>{" "}
                      to verify and maintain these records.{" "}
                    </>
                  )}
                  <Link className="text-brand-700 underline" href={`/brands/${brandProfile.slug}`}>
                    Brand page →
                  </Link>
                </p>
              ) : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <CountCard
                  label="Unverified drafts"
                  value={unverified}
                  href={`/registry?${brandQs}&status=unverified`}
                  tone="amber"
                />
                <CountCard
                  label="Reviewed"
                  value={reviewed}
                  href={`/registry?${brandQs}&status=reviewed`}
                  tone="sky"
                />
                <CountCard
                  label="Manufacturer-verified"
                  value={verified}
                  href={`/registry?${brandQs}&status=verified`}
                  tone="emerald"
                />
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Something wrong?{" "}
                <Link className="text-brand-700 underline" href="/correct">
                  Correct, remove, or verify a record
                </Link>
                , or ask us to hide {brand}&apos;s unverified drafts until
                you&apos;ve reviewed them.
              </p>
            </div>
          ) : null}

          {total !== null ? (
            <p className="mt-5 text-sm text-slate-500">
              The registry holds {total.toLocaleString("en-US")} records from{" "}
              {facets.manufacturers.length} brands:{" "}
              {(totalReviewed ?? 0).toLocaleString("en-US")} reviewed and{" "}
              {(totalVerified ?? 0).toLocaleString("en-US")} manufacturer-verified. The
              rest are unverified drafts.
            </p>
          ) : null}
        </section>

        {/* 3. Three ways to take part */}
        <section id="take-part" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">Three ways to take part</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Way
              title="Review one record"
              time="About 20 minutes"
              cta={{ href: "/correct?type=correction", label: "Send a correction" }}
            >
              Pick one product, compare our draft with your spec sheet, and tell
              us what&apos;s wrong. It&apos;s the quickest way to see how accurate
              the drafts are.
            </Way>
            <Way
              title="A 5-product pilot"
              time="We draft, you approve"
              cta={{ href: `${CONTACT_MAILTO}?subject=${encodeURIComponent("5-product pilot")}`, label: "Start a pilot" }}
            >
              Send us five products and their spec sheets. We prepare the{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-xs">.odio</code>{" "}
              files, you check and approve them, and they go live as
              manufacturer-verified.
            </Way>
            <Way
              title="Claim your brand"
              time="Ongoing"
              cta={{ href: "/brands/claim", label: "Claim your brand" }}
            >
              Maintain your own records directly, by upload, by form, or from
              your build pipeline with an API token, and manage your team and
              brand settings.
            </Way>
          </div>
        </section>

        {/* 4. Claim your brand: how it works, and what a claimed brand controls */}
        <VerificationSteps />

        <section id="claimed-brand" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">What a claimed brand controls</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            <li className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">Records</h3>
              <p className="mt-1 text-sm text-slate-600">
                Publish and update your products as manufacturer-verified, by
                upload, form or API token. Your version replaces the draft. Export
                all of your records at any time.
              </p>
            </li>
            <li className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">Team</h3>
              <p className="mt-1 text-sm text-slate-600">
                Invite colleagues by email and choose who can publish and who can
                manage the brand.
              </p>
            </li>
            <li className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">Settings</h3>
              <p className="mt-1 text-sm text-slate-600">
                Hide unverified drafts until you&apos;ve reviewed them, and choose
                whether community submissions are allowed, come to you as
                suggestions, or are blocked.
              </p>
            </li>
            <li className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">Profile</h3>
              <p className="mt-1 text-sm text-slate-600">
                Your public brand page: a short description, website, support
                link and, if you want one, a product-data contact.
              </p>
            </li>
          </ul>
        </section>

        {/* 5. Correct or remove */}
        <section id="correct" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">
            Correct or remove a record, no sign-up
          </h2>
          <p className="mt-3 text-slate-600">
            Every record page has an &ldquo;Is this your product?&rdquo; link. Use
            it, or the{" "}
            <Link className="text-brand-700 underline" href="/correct">
              request form
            </Link>
            , to ask for a correction or removal. No account is needed. Removals
            are done within {REMOVAL_REQUEST_BUSINESS_DAYS} business days and
            published to our removal feed, so tools that copied the record
            delete it too. You can also ask us to hide all of your unverified
            drafts until you&apos;ve reviewed them.
          </p>
        </section>

        {/* 6. Licensing */}
        <section id="licensing" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">Licensing in plain English</h2>
          <ul className="mt-4 space-y-3 text-slate-600">
            <li>
              <strong className="text-slate-900">Code and schema:</strong> Apache-2.0,
              with an explicit patent grant. Anyone can build importers and tools,
              including commercial ones.
            </li>
            <li>
              <strong className="text-slate-900">Registry data:</strong> CC BY 4.0.
              Design tools may store and show your records with attribution and must
              keep each record&apos;s verification status. See the{" "}
              <Link className="text-brand-700 underline" href="/data-license">
                data license
              </Link>
              .
            </li>
            <li>
              <strong className="text-slate-900">No images or logos.</strong> The
              registry holds no product photos, logos, or drawings, so your brand
              assets stay yours.
            </li>
            <li>
              <strong className="text-slate-900">No endorsement.</strong> Your brand
              and product names appear only to identify devices. Their appearance
              doesn&apos;t mean you endorse OpenDeviceIO, or that it endorses you.
            </li>
          </ul>
        </section>

        {/* 7. Who maintains it */}
        <section id="governance" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">
            Who maintains it, and how it&apos;s governed
          </h2>
          <p className="mt-3 text-slate-600">
            OpenDeviceIO is an independent open project maintained by{" "}
            {MAINTAINERS.map((m) => m.name).join(", ")} (
            <Link className="text-brand-700 underline" href="/about">
              about the project
            </Link>
            ). Changes are made in the open, by pull request and lazy consensus,
            under a vendor-neutral process described in{" "}
            <a className="text-brand-700 underline" href={GOVERNANCE_URL}>
              GOVERNANCE.md
            </a>
            .
          </p>
          <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-5 text-brand-900">
            <p className="font-semibold">An open maintainer seat for manufacturers</p>
            <p className="mt-1 text-sm">
              We want engineers from manufacturers among the maintainers, so the
              format reflects how real products are built. If that interests you,
              email{" "}
              <a className="underline" href={CONTACT_MAILTO}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </div>
        </section>

        {/* 8. FAQ */}
        <section id="faq" className="scroll-mt-24">
          <h2 className="text-2xl font-bold text-slate-900">FAQ</h2>
          <dl className="mt-5 space-y-5">
            <Faq q="Does this replace D-Tools or Stardraw libraries?">
              No. ODIO is an open upstream source of device data that design tools,
              including ones with their own product libraries, could read. It
              doesn&apos;t replace those tools or their libraries.
            </Faq>
            <Faq q="Do we have to write drivers?">
              No. ODIO describes a device&apos;s physical and electrical I/O:
              connectors, signals, power, and dimensions. It doesn&apos;t describe
              control protocols or contain drivers.
            </Faq>
            <Faq q="Does it replace Dante, NDI, or NMOS?">
              No. It references them. A port can say it carries Dante or NDI, for
              example, but ODIO doesn&apos;t define or replace those protocols.
            </Faq>
            <Faq q="Where did the draft data about our products come from?">
              Most drafts were machine-extracted from spec sheets published on
              manufacturers&apos; own websites. Every draft is labeled as
              unverified, names its source document, and can be corrected,
              removed, or hidden at your request.
            </Faq>
            <Faq q="What does it cost?">
              Nothing. There&apos;s no fee, no contract, and no exclusivity.
            </Faq>
          </dl>
        </section>

        {/* 9. Contact */}
        <section id="contact" className="scroll-mt-24 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-xl font-bold text-slate-900">Contact</h2>
          <p className="mt-2 text-slate-600">
            Questions, a pilot, or a record to fix: email{" "}
            <a className="font-medium text-brand-700 underline" href={CONTACT_MAILTO}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}

function CountCard({
  label,
  value,
  href,
  tone
}: {
  label: string;
  value: number | null;
  href: string;
  tone: "amber" | "sky" | "emerald";
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900"
  } as const;
  return (
    <Link href={href} className={`block rounded-xl border p-4 transition hover:shadow-sm ${tones[tone]}`}>
      <div className="text-3xl font-extrabold">{value === null ? "—" : value.toLocaleString("en-US")}</div>
      <div className="mt-1 text-sm font-medium">{label}</div>
    </Link>
  );
}

function Way({
  title,
  time,
  cta,
  children
}: {
  title: string;
  time: string;
  cta: { href: string; label: string };
  children: React.ReactNode;
}) {
  const external = cta.href.startsWith("mailto:");
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-brand-700">{time}</div>
      <h3 className="mt-1 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 flex-1 text-sm text-slate-600">{children}</p>
      {external ? (
        <a href={cta.href} className="mt-4 text-sm font-semibold text-brand-700 hover:underline">
          {cta.label} →
        </a>
      ) : (
        <Link href={cta.href} className="mt-4 text-sm font-semibold text-brand-700 hover:underline">
          {cta.label} →
        </Link>
      )}
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-slate-900">{q}</dt>
      <dd className="mt-1 text-slate-600">{children}</dd>
    </div>
  );
}
