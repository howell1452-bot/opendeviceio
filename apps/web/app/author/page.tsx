import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listMyMemberships } from "@/lib/membership";
import { getRegistryRow } from "@/lib/registry";
import { OdioAuthor } from "./OdioAuthor";
import { OdioEditor } from "./OdioEditor";
import { PublishLicenseNote } from "@/components/PublishLicenseNote";
import { getServiceSupabase } from "@/lib/supabase-server";
import { vendorOrgsForUser } from "@/lib/orgs";

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
  const service = user ? getServiceSupabase() : null;
  const orgs =
    user && service
      ? (await vendorOrgsForUser(service, user.id)).map((o) => ({ slug: o.slug, name: o.name }))
      : [];

  // Edit mode: load an existing registry document into the lossless .odio source editor.
  if (editId) {
    const row = await getRegistryRow(editId);
    const isMember = Boolean(row) && brands.includes(row?.manufacturer ?? "");

    // ?revision=<id>: open a suggested change in the editor. Read with the
    // user's own client, so RLS limits it to the submitter and the brand.
    const revisionId = first(sp.revision);
    let revision: { id: string; document: unknown; status: string } | null = null;
    if (row && revisionId && client) {
      const { data } = await client
        .from("record_revisions")
        .select("id,record_id,document,status")
        .eq("id", revisionId)
        .maybeSingle();
      const r = data as { id: string; record_id: string; document: unknown; status: string } | null;
      if (r && r.record_id === row.id) revision = r;
    }
    const acceptsRevision =
      revision && isMember && (revision.status === "pending" || revision.status === "suggested")
        ? revision.id
        : null;
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
              {isMember
                ? "publish the update for your brand."
                : user
                  ? "submit your change, or download it."
                  : "download it, or sign in to submit your change."}
            </p>
            {revision ? (
              <p className="mt-3 max-w-2xl rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
                Showing a suggested change, not the live record.
                {acceptsRevision
                  ? " Publishing it as manufacturer-verified accepts the suggestion."
                  : null}
              </p>
            ) : null}
            <div className="mt-8">
              <OdioEditor
                initialJson={JSON.stringify(revision ? revision.document : row.document, null, 2)}
                signedIn={Boolean(user)}
                brands={brands}
                orgs={orgs}
                baseRevisionId={
                  (row as { current_revision_id?: string | null }).current_revision_id ?? null
                }
                acceptsRevision={acceptsRevision}
                currentStatus={row.validation_status}
              />
            </div>
            {isMember ? <PublishLicenseNote className="mt-4 max-w-2xl" /> : null}
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
        the standardized I/O table — no hand-editing, all in your browser. Download it for a spec
        sheet, or{" "}
        {brands.length > 0 ? (
          <>publish it to the registry for your approved brand{brands.length > 1 ? "s" : ""}.</>
        ) : user ? (
          <>submit it to the registry as an unverified record.</>
        ) : (
          <>
            <a className="text-brand-700 underline" href="/signin?next=/author">
              sign in
            </a>{" "}
            to submit it to the registry.
          </>
        )}{" "}
        Already published? <Link className="text-brand-700 underline" href="/registry">Find it in the registry</Link> and use its Edit link.
      </p>

      <div className="mt-8">
        <OdioAuthor signedIn={Boolean(user)} brands={brands} orgs={orgs} />
      </div>
      {brands.length > 0 ? (
        <PublishLicenseNote className="mt-4 max-w-2xl" />
      ) : null}
    </div>
  );
}
