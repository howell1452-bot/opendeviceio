// Licensing and integration terms for REGISTRY DATA (the .odio records served
// from /registry and /api/v1). Distinct from the code/schema license
// (Apache-2.0) and the spec/docs license (CC BY 4.0, LICENSE-docs).
//
// Single source of truth: the /data-license page, the API response envelope,
// the `Link: rel="license"` header, and the integration registration form all
// read from here. Bump DATA_TERMS_VERSION whenever the terms page changes in
// substance, so registrations record which version a vendor accepted.

export const SITE_URL = "https://opendeviceio.org";

export const DATA_LICENSE = {
  name: "Creative Commons Attribution 4.0 International",
  short: "CC BY 4.0",
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/"
} as const;

export const DATA_TERMS_PATH = "/data-license";
export const DATA_TERMS_URL = `${SITE_URL}${DATA_TERMS_PATH}`;
export const DATA_TERMS_VERSION = "2026-11-27";

/** Suggested attribution line for a consumer to display with registry data. */
export const ATTRIBUTION_TEXT = `Device data: OpenDeviceIO (${SITE_URL.replace(
  /^https?:\/\//,
  ""
)}), ${DATA_LICENSE.short}`;

/** How often a registered integration should re-sync (days). */
export const SYNC_INTERVAL_DAYS = 30;
/** How quickly a registered integration should act on a removal (days). */
export const REMOVAL_WINDOW_DAYS = 30;

/** Page-size limits for the list API. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;
/** Lower cap when full documents are embedded (`include=document`). */
export const LIST_MAX_LIMIT_WITH_DOCUMENTS = 100;

/** Public URL of a record's registry page (the attribution / source link). */
export function registryUrl(id: string): string {
  return `${SITE_URL}/registry/${id}`;
}

/** Public URL of a record in the REST API. */
export function apiUrl(id: string): string {
  return `${SITE_URL}/api/v1/devices/${id}`;
}

/** Envelope fields every list response carries. */
export function licenseEnvelope() {
  return {
    license: {
      name: DATA_LICENSE.name,
      spdx: DATA_LICENSE.spdx,
      url: DATA_LICENSE.url
    },
    terms_url: DATA_TERMS_URL,
    attribution: ATTRIBUTION_TEXT
  };
}

/** `Link` header value pointing at the data license and terms. */
export const LICENSE_LINK_HEADER = `<${DATA_LICENSE.url}>; rel="license", <${DATA_TERMS_URL}>; rel="terms-of-service"`;

export const VALIDATION_STATUSES = [
  "draft",
  "reviewed",
  "manufacturer-verified"
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const USE_CASES = [
  {
    value: "internal",
    label: "Internal use only",
    help: "Your own staff use the data; it isn't shown to your customers."
  },
  {
    value: "signed-in-users",
    label: "Shown to signed-in customers",
    help: "Displayed inside a commercial product to authenticated users."
  },
  {
    value: "public",
    label: "Shown publicly",
    help: "Displayed on a public website or app without sign-in."
  },
  {
    value: "redistribution",
    label: "Redistributed as data",
    help: "Passed on to third parties as a dataset, export, or API."
  }
] as const;
export type UseCase = (typeof USE_CASES)[number]["value"];
