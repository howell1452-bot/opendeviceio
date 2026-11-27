import type { MetadataRoute } from "next";
import { absoluteUrl } from "./site";

// /robots.txt. Sign-in pages, dashboards, forms that need an account, the API
// and file downloads are kept out of crawls; record and brand pages, the
// listing and the docs are open. Preview hosts also send X-Robots-Tag: noindex
// (next.config.mjs).
export const ROBOTS_DISALLOW = [
  "/admin",
  "/api/",
  "/account",
  "/auth/",
  "/signin",
  "/brands/*/manage",
  "/brands/*/claim",
  "/brands/*/export",
  "/submit",
  "/publish",
  "/author",
  "/registry/download/"
];

export function buildRobots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }],
    sitemap: absoluteUrl("/sitemap.xml")
  };
}
