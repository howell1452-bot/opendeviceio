import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  GOVERNANCE_URL,
  MAINTAINERS,
  REPO_URL
} from "@/lib/project";

export const metadata: Metadata = {
  title: "About",
  description:
    "Who maintains OpenDeviceIO, how the project is governed and licensed, and how to get in touch."
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <article className="prose-odio max-w-none">
        <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
          About
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
          About OpenDeviceIO
        </h1>

        <h2 id="what">What it is</h2>
        <p>
          OpenDeviceIO (ODIO) is an open, machine-readable format for describing
          a hardware device&apos;s connectors, signals, power, physical, and
          compliance data. It comes with a free public{" "}
          <Link href="/registry">registry</Link> and{" "}
          <Link href="/api-docs">API</Link>, so AV and IT design tools can import
          device data instead of re-keying it from PDF spec sheets.
        </p>

        <h2 id="maintainers">Who maintains it</h2>
        <p>
          OpenDeviceIO is an independent open project. It is not affiliated
          with, or endorsed by, any manufacturer or software vendor.
        </p>
        <ul>
          {MAINTAINERS.map((m) => (
            <li key={m.name}>
              <strong>{m.name}</strong>, {m.role}
              {m.bio ? <>. {m.bio}</> : null}
            </li>
          ))}
        </ul>

        <h2 id="governance">How it&apos;s governed</h2>
        <p>
          Changes are proposed in the open as pull requests on{" "}
          <a href={REPO_URL}>GitHub</a> and decided by lazy consensus among
          maintainers. The format follows strict semantic versioning, and
          vendor- or tool-specific needs go under <code>x-</code> extension keys
          rather than into the core. The project aims for maintainers from more
          than one organization, including manufacturers and software vendors.
          The full process is in{" "}
          <a href={GOVERNANCE_URL}>GOVERNANCE.md</a>.
        </p>

        <h2 id="licensing">How it&apos;s licensed</h2>
        <ul>
          <li>
            <strong>Code and JSON Schemas:</strong> Apache-2.0, which includes an
            explicit patent grant.
          </li>
          <li>
            <strong>Specification and documentation:</strong> CC BY 4.0.
          </li>
          <li>
            <strong>Registry data:</strong> CC BY 4.0. See the{" "}
            <Link href="/data-license">data license and integration terms</Link>.
          </li>
        </ul>

        <h2 id="contact">Contact</h2>
        <p>
          Email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> for anything about
          the project: manufacturer participation, corrections to a record,
          integrations, or security reports.
        </p>
      </article>
    </div>
  );
}
