"use client";

import { useState } from "react";
import { submitRecordRequest, type RequestType } from "./actions";

const INPUT =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

const TYPES: { value: RequestType; label: string; help: string }[] = [
  {
    value: "correction",
    label: "Correct it",
    help: "Something in the record is wrong or missing."
  },
  {
    value: "verify",
    label: "Verify it / publish ours",
    help: "We're the manufacturer and want to verify or publish our own data."
  }
];

/** Admins only: a legal takedown, logged like any other request. */
const REMOVAL_TYPE = {
  value: "removal" as RequestType,
  label: "Take down (admin)",
  help: "Legal takedown only, e.g. copyrighted material. Removed ids go to the removal feed."
};

export function RecordRequestForm({
  initialIds,
  initialType,
  contactEmail,
  allowRemoval = false
}: {
  initialIds: string;
  initialType: RequestType;
  contactEmail: string;
  /** Show the admin-only takedown option. */
  allowRemoval?: boolean;
}) {
  const types = allowRemoval ? [...TYPES, REMOVAL_TYPE] : TYPES;
  const [type, setType] = useState<RequestType>(initialType);
  const [startedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await submitRecordRequest(form);
      if (res.ok) {
        setStatus("sent");
      } else {
        setStatus("error");
        setMessage(res.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please email us instead.");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="font-semibold">Thanks, we have your request.</p>
        <p className="mt-1">
          We&apos;ll reply to the email address you gave. If you need to add
          anything, email{" "}
          <a className="underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset>
        <legend className="block text-sm font-medium text-slate-700">
          What would you like us to do?
        </legend>
        <div className={`mt-2 grid gap-2 ${types.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {types.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer flex-col rounded-md border px-3 py-2 ${
                type === t.value
                  ? "border-brand-500 bg-brand-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="request_type"
                  value={t.value}
                  checked={type === t.value}
                  onChange={() => setType(t.value)}
                />
                <span className="text-sm font-medium text-slate-900">{t.label}</span>
              </span>
              <span className="mt-1 text-xs text-slate-500">{t.help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="record_ids" className="block text-sm font-medium text-slate-700">
          Record id(s)
        </label>
        <textarea
          id="record_ids"
          name="record_ids"
          rows={2}
          defaultValue={initialIds}
          placeholder="e.g. crestron/amp-2210ht — or paste registry links, one per line"
          className={`${INPUT} font-mono text-sm`}
        />
        <p className="mt-1 text-xs text-slate-500">
          For all of a brand&apos;s records, leave this empty and say so in Details.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Your name
          </label>
          <input id="name" name="name" required autoComplete="name" className={INPUT} />
        </div>
        <div>
          <label htmlFor="company" className="block text-sm font-medium text-slate-700">
            Company
          </label>
          <input
            id="company"
            name="company"
            required
            autoComplete="organization"
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={INPUT}
          />
        </div>
      </div>

      <div>
        <label htmlFor="details" className="block text-sm font-medium text-slate-700">
          Details{" "}
          <span className="text-slate-400">
            {type === "correction" ? "(required for corrections)" : "(optional)"}
          </span>
        </label>
        <textarea
          id="details"
          name="details"
          rows={4}
          required={type === "correction"}
          placeholder={
            type === "correction"
              ? "What's wrong, and what it should say. A link to the current spec sheet helps."
              : type === "removal"
                ? "The legal basis for the takedown, e.g. the copyrighted material and its owner."
                : "Which products or brands you'd like to verify or publish."
          }
          className={INPUT}
        />
      </div>

      {/* Honeypot: hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="started_at" value={String(startedAt)} />

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {status === "sending" ? "Sending…" : "Send request"}
        </button>
        <span className="text-sm text-slate-500">
          or email{" "}
          <a className="text-brand-700 underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        </span>
      </div>
      {status === "error" ? <p className="text-sm text-red-600">{message}</p> : null}
    </form>
  );
}
