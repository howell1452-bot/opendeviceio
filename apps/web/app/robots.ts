import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/robots";

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
