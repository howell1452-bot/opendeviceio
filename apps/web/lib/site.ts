// The site's public origin, and the canonical URL of each kind of page.
//
// Canonical URLs always use this origin, including on preview deployments
// (*.vercel.app), which next.config.mjs also marks noindex. Override with
// NEXT_PUBLIC_SITE_URL only if the site moves.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://opendeviceio.org").replace(/\/+$/, "");

/** Absolute URL for a site path ("/brands/qsc" -> "https://opendeviceio.org/brands/qsc"). */
export function absoluteUrl(path: string): string {
  if (path === "/" || path === "") return `${SITE_URL}/`;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Path of a record page under its current id. */
export function recordPath(id: string): string {
  return `/registry/${id}`;
}

/** Path of a brand page; page 1 carries no ?page. */
export function brandPath(slug: string, page = 1): string {
  return page > 1 ? `/brands/${slug}?page=${page}` : `/brands/${slug}`;
}

/** robots metadata for pages that should never be indexed (sign-in, dashboards, forms). */
export const NOINDEX = { index: false, follow: true } as const;
