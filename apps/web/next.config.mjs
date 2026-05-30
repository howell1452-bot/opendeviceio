import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK ships as ESM+CJS but is consumed from source-shaped dist; transpile it
  // so Next can bundle it for both server and client where used.
  transpilePackages: ["@opendeviceio/sdk"],
  // The monorepo has multiple lockfiles; pin tracing to this app to silence the
  // inferred-workspace-root warning.
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      {
        // Canonical schema files: JSON content type + permissive CORS so that
        // $ref / $schema resolve from any tool, anywhere.
        source: "/schema/:path*",
        headers: [
          { key: "Content-Type", value: "application/json; charset=utf-8" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Cache-Control", value: "public, max-age=3600" }
        ]
      }
    ];
  }
};

export default nextConfig;
