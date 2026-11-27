// Read magic-link emails from the local Supabase mail catcher (Mailpit in
// current Supabase CLIs, Inbucket in older ones).

const MAIL = (process.env.E2E_MAIL_URL || "http://127.0.0.1:54324").replace(/\/$/, "");

async function json<T>(url: string): Promise<T | null> {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

/** Ids of messages to this address, newest first. */
async function messageIds(email: string): Promise<Array<{ id: string; kind: "mailpit" | "inbucket" }>> {
  const mp = await json<{ messages?: Array<{ ID: string }> }>(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`
  );
  if (mp?.messages) return mp.messages.map((m) => ({ id: m.ID, kind: "mailpit" as const }));
  const box = email.split("@")[0];
  const ib = await json<Array<{ id: string; date: string }>>(`${MAIL}/api/v1/mailbox/${encodeURIComponent(box)}`);
  if (Array.isArray(ib)) {
    return [...ib]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((m) => ({ id: m.id, kind: "inbucket" as const }));
  }
  return [];
}

async function messageText(email: string, m: { id: string; kind: "mailpit" | "inbucket" }): Promise<string> {
  if (m.kind === "mailpit") {
    const body = await json<{ Text?: string; HTML?: string }>(`${MAIL}/api/v1/message/${m.id}`);
    return `${body?.Text ?? ""}\n${body?.HTML ?? ""}`;
  }
  const box = email.split("@")[0];
  const body = await json<{ body?: { text?: string; html?: string } }>(
    `${MAIL}/api/v1/mailbox/${encodeURIComponent(box)}/${m.id}`
  );
  return `${body?.body?.text ?? ""}\n${body?.body?.html ?? ""}`;
}

export async function knownMessageIds(email: string): Promise<Set<string>> {
  return new Set((await messageIds(email)).map((m) => m.id));
}

/** Wait for a new email to `email` and return the Supabase verify link in it. */
export async function waitForMagicLink(email: string, before: Set<string>, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = (await messageIds(email)).find((m) => !before.has(m.id));
    if (fresh) {
      const text = await messageText(email, fresh);
      const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/.exec(text)?.[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link for ${email} within ${timeoutMs} ms (mail catcher: ${MAIL})`);
}
