"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import {
  DATA_LICENSE,
  DATA_TERMS_PATH,
  DATA_TERMS_VERSION,
  USE_CASES,
  type UseCase
} from "@/lib/data-license";

const INPUT =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

export function IntegrationRequestForm({ email }: { email: string }) {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [product, setProduct] = useState("");
  const [website, setWebsite] = useState("");
  const [useCase, setUseCase] = useState<UseCase>("signed-in-users");
  const [includesDrafts, setIncludesDrafts] = useState(true);
  const [note, setNote] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    if (!company.trim() || !agreed) return;
    setStatus("saving");
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setStatus("error");
      setMessage("Your session expired. Please sign in again.");
      return;
    }

    const { error } = await supabase.from("integration_requests").insert({
      user_id: userId,
      email,
      company: company.trim(),
      product: product.trim() || null,
      website: website.trim() || null,
      use_case: useCase,
      includes_drafts: includesDrafts,
      note: note.trim() || null,
      terms_version: DATA_TERMS_VERSION,
      status: "pending"
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setCompany("");
    setProduct("");
    setWebsite("");
    setNote("");
    setAgreed(false);
    setStatus("idle");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="company" className="block text-sm font-medium text-slate-700">
            Company
          </label>
          <input
            id="company"
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Example Software Inc."
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="product" className="block text-sm font-medium text-slate-700">
            Product <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="The product that will use the data"
            className={INPUT}
          />
        </div>
      </div>

      <div>
        <label htmlFor="website" className="block text-sm font-medium text-slate-700">
          Website <span className="text-slate-400">(optional)</span>
        </label>
        <input
          id="website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://"
          className={INPUT}
        />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-slate-700">
          How will the data be used?
        </legend>
        <div className="mt-2 space-y-2">
          {USE_CASES.map((u) => (
            <label
              key={u.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
            >
              <input
                type="radio"
                name="use_case"
                value={u.value}
                checked={useCase === u.value}
                onChange={() => setUseCase(u.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">
                  {u.label}
                </span>
                <span className="block text-sm text-slate-500">{u.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={includesDrafts}
          onChange={(e) => setIncludesDrafts(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-slate-700">
          We plan to include <strong>draft</strong> records (machine-extracted,
          not yet human-reviewed), labeled as drafts in our product.
        </span>
      </label>

      <div>
        <label htmlFor="note" className="block text-sm font-medium text-slate-700">
          Anything else? <span className="text-slate-400">(optional)</span>
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Expected sync frequency, record volume, manufacturers you care about most…"
          className={INPUT}
        />
      </div>

      <label className="flex items-start gap-3 rounded-md border border-brand-200 bg-brand-50 p-3">
        <input
          type="checkbox"
          required
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-brand-900">
          I&apos;m authorized to register for this company, and we accept the{" "}
          <Link href={DATA_TERMS_PATH} className="font-semibold underline" target="_blank">
            registry data license and integration terms
          </Link>{" "}
          (data under {DATA_LICENSE.short}; terms version {DATA_TERMS_VERSION}).
        </span>
      </label>

      <button
        type="submit"
        disabled={status === "saving" || !agreed}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {status === "saving" ? "Submitting…" : "Register integration"}
      </button>
      {status === "error" ? (
        <p className="text-sm text-red-600">{message}</p>
      ) : null}
    </form>
  );
}
