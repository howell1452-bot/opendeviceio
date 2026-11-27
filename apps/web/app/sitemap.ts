import type { MetadataRoute } from "next";
import { loadSitemap } from "@/lib/sitemap";

// Built per request from the live registry (the build must not depend on the DB).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return loadSitemap();
}
