// Project facts shown across the site (About, footer, manufacturer pages,
// correction flow). One place to edit them.

export const CONTACT_EMAIL = "outreach@opendeviceio.org";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

export const REPO_URL = "https://github.com/howell1452-bot/opendeviceio";
export const GOVERNANCE_URL = `${REPO_URL}/blob/main/GOVERNANCE.md`;
export const TRADEMARKS_URL = `${REPO_URL}/blob/main/TRADEMARKS.md`;

export interface Maintainer {
  name: string;
  role: string;
  /**
   * Short bio. Rendered on /about only when non-empty, so the live page never
   * shows placeholder text. Do not name an employer here.
   */
  bio: string;
}

export const MAINTAINERS: Maintainer[] = [
  {
    name: "Austin Howell",
    role: "Maintainer",
    bio: "" // TODO(Austin): 1–2 sentences, no employer.
  }
];
