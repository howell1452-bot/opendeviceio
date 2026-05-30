"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";

export function AccessRequestForm({ email }: { email: string }) {
  const router = useRouter();
  const [manufacturer, setManufacturer] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const brand = manufacturer.trim();
    if (!brand) return;
    setStatus("saving");
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setStatus("error");
      setMessage("Your session expired. Please sign in again.");
      return;
    }

    const { error } = await supabase.from("access_requests").insert({
      user_id: userId,
      email,
      manufacturer: brand,
      note: note.trim() || null,
      status: "pending"
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setManufacturer("");
    setNote("");
    setStatus("idle");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="manufacturer"
          className="block text-sm font-medium text-slate-700"
        >
          Manufacturer / brand name
        </label>
        <input
          id="manufacturer"
          required
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
          placeholder="e.g. Lightware"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div>
        <label
          htmlFor="note"
          className="block text-sm font-medium text-slate-700"
        >
          Note <span className="text-slate-400">(optional)</span>
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Your role, company domain, or anything that helps us verify you represent this brand."
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <button
        type="submit"
        disabled={status === "saving"}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {status === "saving" ? "Submitting…" : "Submit request"}
      </button>
      {status === "error" ? (
        <p className="text-sm text-red-600">{message}</p>
      ) : null}
    </form>
  );
}
