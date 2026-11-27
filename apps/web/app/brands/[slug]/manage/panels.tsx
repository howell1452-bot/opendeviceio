"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  inviteMember,
  removeMember,
  revokeInvite,
  setCommunitySubmissions,
  setHideDrafts,
  setMemberRole,
  updateBrandProfile
} from "../../actions";

type Role = "publisher" | "brand-admin";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function run(fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, okText = "Saved.") {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ ok: true, text: res.message ?? okText });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });
  }
  return { pending, msg, run };
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export function TeamPanel({
  slug,
  members,
  invites,
  meId,
  canAdminister
}: {
  slug: string;
  members: Array<{ userId: string; email: string | null; role: Role; createdAt: string | null }>;
  invites: Array<{ id: string; email: string; role: Role; createdAt: string }>;
  meId: string;
  canAdminister: boolean;
}) {
  const { pending, msg, run } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("publisher");

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-base font-semibold text-slate-900">Members</h3>
        <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 break-all text-slate-900">
                {m.email ?? "(unknown)"}
                {m.userId === meId ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
              </span>
              {canAdminister ? (
                <span className="flex items-center gap-2">
                  <select
                    aria-label={`Role for ${m.email ?? "member"}`}
                    value={m.role}
                    disabled={pending}
                    onChange={(e) => run(() => setMemberRole(slug, m.userId, e.target.value as Role))}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                  >
                    <option value="publisher">Publisher</option>
                    <option value="brand-admin">Brand-admin</option>
                  </select>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Remove ${m.email ?? "this member"} from the team?`)) {
                        run(() => removeMember(slug, m.userId), "Removed.");
                      }
                    }}
                    className="text-xs font-medium text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </span>
              ) : (
                <span className="text-xs text-slate-500">{m.role === "brand-admin" ? "Brand-admin" : "Publisher"}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Publishers publish and update records. Brand-admins also manage the team, settings and
          profile. A brand always keeps at least one brand-admin.
        </p>
      </section>

      {canAdminister ? (
        <section>
          <h3 className="text-base font-semibold text-slate-900">Invite a colleague</h3>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => inviteMember(slug, email, role));
              setEmail("");
            }}
          >
            <label className="block min-w-0 flex-1 text-xs font-medium text-slate-600">
              Work email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="publisher">Publisher</option>
                <option value="brand-admin">Brand-admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:opacity-40"
            >
              Invite
            </button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Colleagues with an email at one of the brand&apos;s verified domains join when they sign
            in. Anyone else is reviewed by OpenDeviceIO first.
          </p>
          {invites.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 break-all">
                    {i.email} <span className="text-xs text-slate-500">· {i.role} · invited {i.createdAt.slice(0, 10)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => revokeInvite(slug, i.id), "Invite revoked.")}
                    className="text-xs font-medium text-red-700 hover:underline"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <Message msg={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function SettingsPanel({
  slug,
  hidden,
  communitySubmissions
}: {
  slug: string;
  hidden: boolean;
  communitySubmissions: "allowed" | "suggestions-only" | "blocked";
}) {
  const { pending, msg, run } = useAction();
  // Optimistic: show the new value at once, revert if the save fails.
  const [hiddenNow, setHiddenNow] = useState(hidden);
  const [communityNow, setCommunityNow] = useState(communitySubmissions);
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-base font-semibold text-slate-900">Unverified drafts</h3>
        <label className="mt-3 flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={hiddenNow}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.checked;
              setHiddenNow(next);
              run(async () => {
                const res = await setHideDrafts(slug, next);
                if (!res.ok) setHiddenNow(!next);
                return res;
              });
            }}
            className="mt-1"
          />
          <span>
            <strong>Hide unverified drafts until reviewed.</strong> Drafts of your products leave
            the public registry and API. Your team still sees them here and can verify them;
            reviewed and manufacturer-verified records stay public.
          </span>
        </label>
      </section>
      <section>
        <h3 className="text-base font-semibold text-slate-900">Community submissions</h3>
        <p className="mt-1 text-sm text-slate-600">
          What happens when someone outside your team submits a record or a change for your brand.
        </p>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {(
            [
              ["allowed", "Allowed", "Submissions follow the registry's normal rules. Changes to your verified records always come to you as suggestions."],
              ["suggestions-only", "Suggestions only", "Every submission waits for your team as a suggested change."],
              ["blocked", "Blocked", "Nobody outside your team can submit records for your brand."]
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="flex items-start gap-3">
              <input
                type="radio"
                name="community"
                checked={communityNow === value}
                disabled={pending}
                onChange={() => {
                  const before = communityNow;
                  setCommunityNow(value);
                  run(async () => {
                    const res = await setCommunitySubmissions(slug, value);
                    if (!res.ok) setCommunityNow(before);
                    return res;
                  });
                }}
                className="mt-1"
              />
              <span>
                <strong>{label}.</strong> {help}
              </span>
            </label>
          ))}
        </div>
      </section>
      <Message msg={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function ProfileForm({
  slug,
  initial
}: {
  slug: string;
  initial: { description: string; website: string; supportUrl: string; dataContact: string };
}) {
  const { pending, msg, run } = useAction();
  const [v, setV] = useState(initial);
  const field = "mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateBrandProfile(slug, v));
      }}
    >
      <label className="block text-xs font-medium text-slate-600">
        Description ({v.description.length}/600)
        <textarea
          rows={4}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value.slice(0, 600) })}
          className={field}
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Website
        <input type="url" placeholder="https://" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} className={field} />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Support URL
        <input type="url" placeholder="https://" value={v.supportUrl} onChange={(e) => setV({ ...v, supportUrl: e.target.value })} className={field} />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Public product-data contact (optional)
        <input
          value={v.dataContact}
          onChange={(e) => setV({ ...v, dataContact: e.target.value.slice(0, 200) })}
          placeholder="e.g. productdata@yourbrand.com"
          className={field}
        />
        <span className="mt-1 block font-normal text-slate-500">
          Shown on your public brand page. Leave empty to show none.
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
      <Message msg={msg} />
    </form>
  );
}
