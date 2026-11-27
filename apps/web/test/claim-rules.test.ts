import { describe, expect, it } from "vitest";
import {
  domainMatches,
  emailDomain,
  inviteAutoAccepts,
  isFreeMailDomain,
  leavesNoAdmin,
  normalizeDomain,
  roleForNewMember,
  suggestAddDomain
} from "../lib/claim-rules";
import { manufacturerSlug } from "../lib/submission-doc";

describe("email domains", () => {
  it("derives the lowercased domain", () => {
    expect(emailDomain("Rep@Crestron.COM")).toBe("crestron.com");
    expect(emailDomain(" a.b+c@eu.shure.com ")).toBe("eu.shure.com");
    expect(emailDomain("no-at-sign")).toBeNull();
    expect(emailDomain("@crestron.com")).toBeNull();
    expect(emailDomain("x@localhost")).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });

  it("flags free-mail providers, including country variants", () => {
    for (const d of ["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "proton.me", "yahoo.co.uk", "hotmail.de"]) {
      expect(isFreeMailDomain(d)).toBe(true);
    }
    for (const d of ["crestron.com", "shure.com", "qsc.com"]) {
      expect(isFreeMailDomain(d)).toBe(false);
    }
  });

  it("normalizes a domain an admin types", () => {
    expect(normalizeDomain("https://www.Crestron.com/products")).toBe("crestron.com");
    expect(normalizeDomain("@shure.com")).toBe("shure.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});

describe("domain matching", () => {
  it("matches exact domains and subdomains of a verified domain", () => {
    expect(domainMatches("crestron.com", ["crestron.com"])).toBe(true);
    expect(domainMatches("eu.crestron.com", ["crestron.com"])).toBe(true);
    expect(domainMatches("notcrestron.com", ["crestron.com"])).toBe(false);
    expect(domainMatches("crestron.com", [])).toBe(false);
    expect(domainMatches(null, ["crestron.com"])).toBe(false);
  });

  it("never matches free mail, even if listed by mistake", () => {
    expect(domainMatches("gmail.com", ["gmail.com"])).toBe(false);
    expect(inviteAutoAccepts("someone@gmail.com", ["gmail.com"])).toBe(false);
  });

  it("suggests adding a brand domain on approval, but not a free-mail one", () => {
    expect(suggestAddDomain("crestron.com")).toBe(true);
    expect(suggestAddDomain("gmail.com")).toBe(false);
    expect(suggestAddDomain(null)).toBe(false);
  });

  it("auto-accepts invites only for the brand's domains", () => {
    expect(inviteAutoAccepts("pat@crestron.com", ["crestron.com"])).toBe(true);
    expect(inviteAutoAccepts("pat@contractor.com", ["crestron.com"])).toBe(false);
  });
});

describe("team roles", () => {
  const admin = { userId: "a", role: "brand-admin" as const };
  const pub = { userId: "p", role: "publisher" as const };

  it("makes the first member of a brand its brand-admin", () => {
    expect(roleForNewMember([])).toBe("brand-admin");
    expect(roleForNewMember([admin])).toBe("publisher");
  });

  it("won't remove or demote the last brand-admin", () => {
    expect(leavesNoAdmin([admin, pub], { userId: "a", remove: true })).toBe(true);
    expect(leavesNoAdmin([admin, pub], { userId: "a", role: "publisher" })).toBe(true);
    expect(leavesNoAdmin([admin, pub], { userId: "p", remove: true })).toBe(false);
    expect(leavesNoAdmin([admin, { userId: "b", role: "brand-admin" }], { userId: "a", remove: true })).toBe(false);
    expect(leavesNoAdmin([admin, pub], { userId: "p", role: "brand-admin" })).toBe(false);
  });
});

describe("slugs", () => {
  it("match the SQL private.brand_slug() for the registry's brands", () => {
    const cases: Record<string, string> = {
      "1Beyond": "1beyond",
      "Attero Tech": "attero-tech",
      "Extreme Networks": "extreme-networks",
      NETGEAR: "netgear",
      "Stem Audio": "stem-audio",
      "New Brand & Co": "new-brand-and-co"
    };
    for (const [name, slug] of Object.entries(cases)) expect(manufacturerSlug(name)).toBe(slug);
  });
});
