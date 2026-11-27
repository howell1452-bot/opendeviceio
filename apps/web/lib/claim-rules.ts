// Brand claim and team rules (claim-your-brand brief). Pure: no I/O, unit
// tested in test/claim-rules.test.ts.

/**
 * Consumer mailbox providers. A claim from one of these never matches a
 * brand's domain and is never auto-approved; admins see a warning.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.io"
]);

/** The lowercased domain of an email address, or null if it isn't one. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.trim().lastIndexOf("@");
  if (at <= 0) return null;
  const domain = email.trim().slice(at + 1).toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)
    ? domain
    : null;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (FREE_MAIL_DOMAINS.has(d)) return true;
  // yahoo.co.uk, outlook.fr, hotmail.de, ...
  const parts = d.split(".");
  return parts.length >= 2 && ["yahoo", "hotmail", "outlook", "live", "gmx"].includes(parts[0]);
}

/** Normalize a domain an admin types: lowercase, no scheme, path or leading "www." / "@". */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return emailDomain(`x@${d}`);
}

/**
 * Does an email domain belong to the brand? Exact match with a verified
 * domain, or a subdomain of one (eu.crestron.com for crestron.com). Free-mail
 * domains never match, even if an admin added one by mistake.
 */
export function domainMatches(
  domain: string | null | undefined,
  verifiedDomains: readonly string[] | null | undefined
): boolean {
  if (!domain || isFreeMailDomain(domain)) return false;
  const d = domain.toLowerCase();
  return (verifiedDomains ?? []).some((v) => {
    const vd = v.toLowerCase();
    return !isFreeMailDomain(vd) && (d === vd || d.endsWith(`.${vd}`));
  });
}

/** Default for the admin's "add this domain to the brand" checkbox. */
export function suggestAddDomain(domain: string | null | undefined): boolean {
  return Boolean(domain) && !isFreeMailDomain(domain);
}

export type MemberRole = "publisher" | "brand-admin";

export interface TeamMember {
  userId: string;
  role: MemberRole;
}

/** The role a newly approved member gets: the brand's first member administers it. */
export function roleForNewMember(existing: readonly TeamMember[]): MemberRole {
  return existing.length === 0 ? "brand-admin" : "publisher";
}

/**
 * Would this change leave the brand without a brand-admin? A brand must keep
 * at least one, so the last brand-admin can't be removed or demoted.
 */
export function leavesNoAdmin(
  members: readonly TeamMember[],
  change: { userId: string; remove?: boolean; role?: MemberRole }
): boolean {
  const after = members
    .filter((m) => !(change.remove && m.userId === change.userId))
    .map((m) => (m.userId === change.userId && change.role ? { ...m, role: change.role } : m));
  return !after.some((m) => m.role === "brand-admin");
}

/** An invited colleague is added on sign-in only when their domain is the brand's. */
export function inviteAutoAccepts(
  email: string,
  verifiedDomains: readonly string[] | null | undefined
): boolean {
  return domainMatches(emailDomain(email), verifiedDomains);
}
