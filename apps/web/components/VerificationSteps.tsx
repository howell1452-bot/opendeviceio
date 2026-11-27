import Link from "next/link";
import {
  ACCESS_APPROVAL_BUSINESS_DAYS,
  CONTACT_EMAIL,
  CONTACT_MAILTO
} from "@/lib/project";

/**
 * "How verification works" for manufacturers. Public (no sign-in needed);
 * shown on /contribute and /manufacturers.
 */
export function VerificationSteps({ id = "verification" }: { id?: string }) {
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "Claim your brand with your work email",
      body: (
        <>
          Sign in with an email address at your brand&apos;s domain and{" "}
          <Link className="text-brand-700 underline" href="/brands/claim">
            claim your brand
          </Link>
          . Sign-in is a one-time email link; there&apos;s no password.
        </>
      )
    },
    {
      title: "We check who you are",
      body: (
        <>
          We confirm your email domain belongs to the brand (for example
          @yourbrand.com) and that your role fits, such as product management,
          engineering, technical documentation, or alliances. If you&apos;re at
          an agency or distributor, we&apos;ll ask someone at the brand to confirm.
        </>
      )
    },
    {
      title: `Approval within ${ACCESS_APPROVAL_BUSINESS_DAYS} business days`,
      body: (
        <>
          That&apos;s our target from your request. We&apos;ll email you if we
          need anything else.
        </>
      )
    },
    {
      title: "What you can do once approved",
      body: (
        <>
          Publish files for your brand by upload, by filling in a form, or from
          a script with an API token. Edit existing drafts: what you publish
          replaces the draft and shows as <strong>manufacturer-verified</strong>.
        </>
      )
    },
    {
      title: "Free, no exclusivity, no contract",
      body: (
        <>
          There&apos;s no fee and nothing to sign. Published records are shared
          under the{" "}
          <Link className="text-brand-700 underline" href="/data-license">
            registry data license
          </Link>{" "}
          (CC BY 4.0), so any design tool can use them. You can keep publishing
          your data anywhere else.
        </>
      )
    },
    {
      title: "Leave at any time",
      body: (
        <>
          Email{" "}
          <a className="text-brand-700 underline" href={CONTACT_MAILTO}>
            {CONTACT_EMAIL}
          </a>{" "}
          and we&apos;ll remove your access. Your published records stay up.
        </>
      )
    }
  ];

  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold text-slate-900">Claim your brand</h2>
      <ol className="mt-5 space-y-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {i + 1}
            </span>
            <div>
              <h3 className="font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
