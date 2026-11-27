import { CONTACT_EMAIL } from "./project";
import { SITE_URL } from "./data-license";

// Transactional email for brand claims (claim-your-brand brief, item 4).
// Sent through Resend's HTTP API when RESEND_API_KEY is set; without it every
// send is skipped and logged, so nothing else depends on email working.
// Server-only. Addresses are only ever passed to the email provider, never
// stored in public tables.
//
// Env:
//   RESEND_API_KEY   enables sending
//   NOTIFY_FROM      sender, e.g. "OpenDeviceIO <notifications@opendeviceio.org>"
//                    (the domain must be verified in Resend)
//   NOTIFY_ADMIN_TO  where new-claim alerts go (default: the contact address)

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export type SendResult = { sent: true } | { sent: false; reason: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(email: Email): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // eslint-disable-next-line no-console
    console.info(`[odio] email not configured; skipped "${email.subject}"`);
    return { sent: false, reason: "not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || `OpenDeviceIO <${CONTACT_EMAIL}>`,
        to: [email.to],
        subject: email.subject,
        text: email.text
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.error(`[odio] email failed (${res.status}): ${body.slice(0, 300)}`);
      return { sent: false, reason: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[odio] email threw:", err);
    return { sent: false, reason: "network error" };
  }
}

const adminTo = () => process.env.NOTIFY_ADMIN_TO || CONTACT_EMAIL;

// ---------------------------------------------------------------------------
// Messages (plain text; no tracking)
// ---------------------------------------------------------------------------

export function newClaimEmail(args: {
  brand: string;
  slug: string;
  claimantEmail: string | null;
  domain: string | null;
  domainMatch: boolean;
  freeMail: boolean;
  requesterRole: string | null;
}): Email {
  const flag = args.freeMail
    ? "WARNING: free email provider; never auto-approved."
    : args.domainMatch
      ? "The email domain matches the brand's verified domains."
      : "The email domain is not yet a verified domain for this brand.";
  return {
    to: adminTo(),
    subject: `Brand claim: ${args.brand}`,
    text: [
      `New claim for ${args.brand} (${SITE_URL}/brands/${args.slug}).`,
      "",
      `Claimant: ${args.claimantEmail ?? "(unknown)"}${args.requesterRole ? `, ${args.requesterRole}` : ""}`,
      `Email domain: ${args.domain ?? "(none)"}`,
      flag,
      "",
      `Review it at ${SITE_URL}/admin`
    ].join("\n")
  };
}

export function claimApprovedEmail(args: { to: string; brand: string; slug: string }): Email {
  return {
    to: args.to,
    subject: `You can now manage ${args.brand} on OpenDeviceIO`,
    text: [
      `Your claim for ${args.brand} on OpenDeviceIO is approved.`,
      "",
      `Brand dashboard: ${SITE_URL}/brands/${args.slug}/manage`,
      `Publish a record: ${SITE_URL}/publish`,
      "",
      "Records you publish show as manufacturer-verified. From the dashboard you can",
      "invite colleagues, change brand settings and edit the brand profile.",
      "",
      `Questions: ${CONTACT_EMAIL}`
    ].join("\n")
  };
}

export function claimRejectedEmail(args: { to: string; brand: string; note: string | null }): Email {
  return {
    to: args.to,
    subject: `Your claim for ${args.brand} on OpenDeviceIO`,
    text: [
      `We couldn't approve your claim for ${args.brand} on OpenDeviceIO.`,
      ...(args.note ? ["", `Note from the reviewer: ${args.note}`] : []),
      "",
      `If you think this is a mistake, reply to ${CONTACT_EMAIL} from your work email.`
    ].join("\n")
  };
}

export function inviteEmail(args: { to: string; brand: string; slug: string; autoAccept: boolean }): Email {
  return {
    to: args.to,
    subject: `You're invited to help maintain ${args.brand} on OpenDeviceIO`,
    text: [
      `A colleague invited you to maintain ${args.brand}'s records on OpenDeviceIO.`,
      "",
      `Sign in with this email address at ${SITE_URL}/signin?next=/brands/${args.slug}/manage`,
      args.autoAccept
        ? "You'll be added to the team when you sign in."
        : "Your email domain isn't verified for this brand yet, so an OpenDeviceIO admin will review it after you sign in.",
      "",
      `Questions: ${CONTACT_EMAIL}`
    ].join("\n")
  };
}
