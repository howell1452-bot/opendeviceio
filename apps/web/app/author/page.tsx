import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { OdioAuthor } from "./OdioAuthor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Author an .odio file",
  description:
    "Create a valid OpenDeviceIO (.odio) device file from a simple form — identity, ports, signals, and power — with a live I/O-table preview. Download it, or (for approved manufacturers) publish it to the registry for your brand."
};

export default async function AuthorPage() {
  // Authoring + download is public. Publishing to the registry is gated to signed-in
  // manufacturers and scoped to their approved brands (the API enforces this too).
  const { user, client } = await getCurrentUser();
  const memberships = user && client ? await listMyMemberships(client) : [];
  const brands = memberships.map((m) => m.manufacturer);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Tools</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Author an .odio file</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Describe a device&apos;s I/O once and get a validated{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.odio</code> file plus
        the standardized I/O table — no JSON by hand, all in your browser. Download it for a spec
        sheet, or{" "}
        {brands.length > 0 ? (
          <>publish it to the registry for your approved brand{brands.length > 1 ? "s" : ""}.</>
        ) : (
          <>
            <a className="text-brand-700 underline" href="/contribute">
              sign in as a manufacturer
            </a>{" "}
            to publish it to the registry.
          </>
        )}
      </p>

      <div className="mt-8">
        <OdioAuthor signedIn={Boolean(user)} brands={brands} />
      </div>
    </div>
  );
}
