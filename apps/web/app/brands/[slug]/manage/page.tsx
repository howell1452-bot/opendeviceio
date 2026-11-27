import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadBrandContext } from "@/lib/brand-access";
import { getCurrentUser } from "@/lib/session";
import { STATUS_FILTERS } from "@/lib/status-filters";
import { loadBrandQueue } from "@/lib/submission-queue";
import { SourceBadge, StatusBadge } from "@/components/Badge";
import { SubmissionRow } from "@/components/SubmissionRow";
import { ProfileForm, SettingsPanel, TeamPanel } from "./panels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Brand dashboard",
  robots: { index: false, follow: false }
};

const TABS = [
  ["records", "Records"],
  ["team", "Team"],
  ["settings", "Settings"],
  ["profile", "Profile"],
  ["suggestions", "Suggestions"]
] as const;
type Tab = (typeof TABS)[number][0];
const ADMIN_TABS: ReadonlySet<Tab> = new Set(["settings", "profile"]);
const PAGE_SIZE = 50;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function BrandManagePage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const res = await loadBrandContext(slug);
  if (!res.ok) {
    if (res.status === 401) redirect(`/signin?next=${encodeURIComponent(`/brands/${slug}/manage`)}`);
    if (res.status === 404) notFound();
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Brand dashboard</h1>
        <p className="mt-3 text-slate-600">{res.error}</p>
        {res.status === 403 ? (
          <p className="mt-3 text-sm">
            <Link className="text-brand-700 underline" href={`/brands/${slug}/claim`}>
              Claim this brand
            </Link>{" "}
            or ask a colleague on the team to invite you.
          </p>
        ) : null}
      </div>
    );
  }
  const { ctx } = res;
  const { org, service } = ctx;
  const tab: Tab = (TABS.find(([t]) => t === first(sp.tab))?.[0] ?? "records") as Tab;
  const locked = ADMIN_TABS.has(tab) && !ctx.canAdminister;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Link href={`/brands/${org.slug}`} className="text-sm font-medium text-brand-700 hover:text-brand-900">
        ← {org.name} public page
      </Link>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">{org.name} dashboard</h1>
      <p className="mt-2 text-sm text-slate-600">
        {ctx.myRole === "brand-admin"
          ? "You're a brand-admin."
          : ctx.myRole === "publisher"
            ? "You're a publisher."
            : "You're viewing as an OpenDeviceIO admin."}
      </p>

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={`/brands/${org.slug}/manage${t === "records" ? "" : `?tab=${t}`}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 font-medium ${
              t === tab ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {locked ? (
          <p className="text-sm text-slate-600">Only a brand-admin can change this. Ask a brand-admin on your team.</p>
        ) : tab === "records" ? (
          await RecordsTab({ ctx, status: first(sp.status), page: Number.parseInt(first(sp.page) || "1", 10) || 1 })
        ) : tab === "team" ? (
          await TeamTab({ ctx })
        ) : tab === "settings" ? (
          await SettingsTab({ ctx })
        ) : tab === "profile" ? (
          <ProfileForm
            slug={org.slug}
            initial={{
              description: org.description ?? "",
              website: org.website ?? "",
              supportUrl: org.support_url ?? "",
              dataContact: org.data_contact ?? ""
            }}
          />
        ) : (
          await SuggestionsTab({ ctx, service })
        )}
      </div>
    </div>
  );
}

type Ctx = Extract<Awaited<ReturnType<typeof loadBrandContext>>, { ok: true }>["ctx"];

async function RecordsTab({ ctx, status, page }: { ctx: Ctx; status: string; page: number }) {
  const { org, service } = ctx;
  const filter = STATUS_FILTERS.find((s) => s.value === status);
  let q = service
    .from("registry")
    .select("id,model,validation_status,source_type,updated_at,source_org:organizations(name)", { count: "exact" })
    .eq("manufacturer", org.manufacturer);
  if (filter) q = q.in("validation_status", [...filter.statuses]);
  const from = (Math.max(1, page) - 1) * PAGE_SIZE;
  const { data, count } = await q
    .order("model", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    model: string | null;
    validation_status: string | null;
    source_type: string | null;
    updated_at: string | null;
    source_org: { name: string } | null;
  }>;
  const total = count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const base = `/brands/${org.slug}/manage`;
  const link = (p: number, s = status) => `${base}?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/publish" className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">
          Publish a file
        </Link>
        <a href={`/brands/${org.slug}/export${status ? `?status=${status}` : ""}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-brand-400">
          Export records (.odio documents)
        </a>
        <Link href="/account" className="rounded-md px-3 py-1.5 font-medium text-brand-700 hover:underline">
          API tokens
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {[["", "All"], ...STATUS_FILTERS.map((s) => [s.value, s.label] as const)].map(([value, label]) => (
          <Link
            key={value || "all"}
            href={link(1, value)}
            className={`rounded-full px-3 py-1 ring-1 ring-inset ${
              value === status ? "bg-brand-50 text-brand-800 ring-brand-200" : "text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">
        {total} {total === 1 ? "record" : "records"}, including any hidden drafts.
      </p>
      <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/registry/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                {r.model ?? r.id}
              </Link>
              <div className="break-all font-mono text-xs text-slate-500">{r.id}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={r.validation_status} />
              <SourceBadge source={r.source_type} org={r.source_org?.name} />
              <Link href={`/author?id=${encodeURIComponent(r.id)}`} className="ml-1 text-xs font-medium text-emerald-700 underline">
                {r.validation_status === "manufacturer-verified" ? "Update" : "Verify / update"}
              </Link>
            </div>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-4 py-6 text-sm text-slate-500">No records.</li> : null}
      </ul>
      {pages > 1 ? (
        <nav className="mt-4 flex justify-between text-sm">
          {page > 1 ? <Link className="text-brand-700 underline" href={link(page - 1)}>← Previous</Link> : <span />}
          {page < pages ? <Link className="text-brand-700 underline" href={link(page + 1)}>Next →</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

async function TeamTab({ ctx }: { ctx: Ctx }) {
  const { data } = await ctx.service
    .from("brand_invites")
    .select("id,email,role,created_at")
    .eq("org_id", ctx.org.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const invites = ((data ?? []) as Array<{ id: string; email: string; role: "publisher" | "brand-admin"; created_at: string }>).map(
    (i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at })
  );
  return (
    <TeamPanel
      slug={ctx.org.slug}
      members={ctx.members}
      invites={ctx.canAdminister ? invites : []}
      meId={ctx.user.id}
      canAdminister={ctx.canAdminister}
    />
  );
}

async function SettingsTab({ ctx }: { ctx: Ctx }) {
  const { data } = await ctx.service
    .from("brand_settings")
    .select("hidden_until_opt_in,community_submissions")
    .eq("manufacturer", ctx.org.manufacturer)
    .maybeSingle();
  const s = data as { hidden_until_opt_in: boolean; community_submissions: "allowed" | "suggestions-only" | "blocked" } | null;
  return (
    <SettingsPanel
      slug={ctx.org.slug}
      hidden={s?.hidden_until_opt_in ?? false}
      communitySubmissions={s?.community_submissions ?? "allowed"}
    />
  );
}

async function SuggestionsTab({ ctx, service }: { ctx: Ctx; service: Ctx["service"] }) {
  // Members read through their own session (RLS: brand members read their
  // brand's revisions); an admin viewing another brand reads with the service client.
  const { client } = await getCurrentUser();
  const reader = ctx.myRole && client ? client : service;
  const items = await loadBrandQueue(reader, service, [ctx.org.manufacturer]);
  return (
    <div>
      <p className="text-sm text-slate-600">
        Community and design-vendor submissions for {ctx.org.name}. Accepting one publishes it as{" "}
        <strong>manufacturer-verified</strong>; you can edit it first.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nothing waiting.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <SubmissionRow key={item.id} item={item} mode="brand" />
          ))}
        </ul>
      )}
    </div>
  );
}
