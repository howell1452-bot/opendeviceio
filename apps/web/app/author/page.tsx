import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { getRegistryRow } from "@/lib/registry";
import { OdioAuthor } from "./OdioAuthor";
import { OdioEditor } from "./OdioEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Author or edit an .odio file",
  description:
    "Create a valid OpenDeviceIO (.odio) device from a form, or edit an existing registry device's document. Download it, or (for approved manufacturers) publish/update it for your brand."
};

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function AuthorPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const editId = first(sp.id);

  // Authoring + download is public. Publishing/updating is gated to signed-in
  // manufacturers, scoped to their approved brands (the API enforces it too).
  const { user, client } = await getCurrentUser();
  const memberships = user && client ? await listMyMemberships(client) : [];
  const brands = memberships.map((m) => m.manufacturer);

  // Edit mode: load an existing registry document into the lossless JSON editor.
  if (editId) {
    const row = await getRegistryRow(editId);
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Tools</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
          {row ? `Edit ${row.manufacturer ?? ""} ${row.model ?? editId}`.trim() : "Edit a device"}
        </h1>
        {row ? (
          <>
            <p className="mt-3 max-w-2xl text-slate-600">
              Editing{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">{row.id}</code>.
              The full document is editable (nothing is dropped). Fix or update it, then{" "}
              {brands.includes(row.manufacturer ?? "")
                ? "publish the update for your brand."
                : "download it — publishing requires manufacturer approval for this brand."}
            </p>
            <div className="mt-8">
              <OdioEditor
                initialJson={JSON.stringify(row.document, null, 2)}
                signedIn={Boolean(user)}
                brands={brands}
              />
            </div>
          </>
        ) : (
          <p className="mt-3 text-slate-600">
            No registry entry found for{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">{editId}</code>.{" "}
            <Link className="text-brand-700 underline" href="/author">
              Author a new device
            </Link>{" "}
            instead.
          </p>
        )}
      </div>
    );
  }

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
        )}{" "}
        Already published? <Link className="text-brand-700 underline" href="/registry">Find it in the registry</Link> and use its Edit link.
      </p>

      <div className="mt-8">
        <OdioAuthor signedIn={Boolean(user)} brands={brands} />
      </div>
    </div>
  );
}
