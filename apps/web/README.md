# OpenDeviceIO website (`@opendeviceio/web`)

The public OpenDeviceIO site: the spec home, the whitepaper, the manufacturer
authoring guide, **canonical schema hosting**, and a **read-only** browser for the
device / bundle / cable registry (backed by Supabase).

Built with Next.js (App Router, TypeScript) and Tailwind CSS. It reuses the
monorepo's `@opendeviceio/sdk` (resolved through npm workspaces, dependency
`"@opendeviceio/sdk": "*"`) for ODIO types and the `flattenBundle` /
`bundleBillOfMaterials` accessors.

## Deployment (Vercel / npm workspaces)

The repo is a single npm workspace (root `package.json` `workspaces`). Vercel
auto-detects the workspace root and runs one `npm install` there. The SDK's
`prepare` script (`npm run build`) builds `packages/ts-sdk/dist` during that
install, so by the time `next build` runs the workspace-linked
`@opendeviceio/sdk` is already built — no custom `buildCommand` is needed.
`vercel.json` is therefore minimal (`{ "framework": "nextjs" }`). The app's
`prebuild` still runs `sync-schema` to copy the canonical schema files.

> v1 scope is **read-only**: no submission flow, no auth, no hosted Genie.

## Routes

| Route | Description |
| --- | --- |
| `/` | Spec home: the problem, the connector → link → signals model, and links out. |
| `/whitepaper` | Long-form whitepaper (motivation, data model, bundles/cables, governance, roadmap). |
| `/guide` | Manufacturer authoring guide (by hand, via the SDK, or via Genie; id/`x-` rules; validation). |
| `/registry` | Registry browser with search + kind/category/connector filters. |
| `/registry/[...id]` | Detail page for one entry (catch-all because ids contain a slash). |
| `/registry/download/[...id]` | Raw `.odio` download (`application/vnd.odio+json`, `attachment`). |
| `/schema/v0.1/device.schema.json` | Canonical device schema (served verbatim, `application/json`, permissive CORS). |
| `/schema/v0.1/bundle.schema.json` | Canonical bundle schema. |
| `/schema/v0.1/cable.schema.json` | Canonical cable schema. |

All registry data is fetched at **request time** (`export const dynamic = "force-dynamic"`),
so `next build` never depends on the database being populated or reachable.

## Environment variables

Copy `.env.local.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://vkbgtbvawhuajkortcka.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

Both are **public** values. The publishable (anon) key is safe to ship to the
browser because Row Level Security on `public.registry` permits `SELECT` only.
If the variables are unset or the database is unreachable, the registry renders a
graceful empty state and the rest of the site works normally.

## Develop

```bash
npm install
npm run dev        # runs `sync-schema` first (predev), then `next dev` on :3000
```

`npm run sync-schema` copies `../../schema/v0.1/*.schema.json` into
`public/schema/v0.1/` **byte-for-byte** so the canonical files are served at their
versioned `$id` URLs. It runs automatically before `dev` and `build`.

## Build

```bash
npm install
npm run sync-schema   # (also runs automatically as `prebuild`)
npm run build         # succeeds even with an empty / unreachable database
npm start             # serve the production build
```

## Registry data (read-only)

- The schema lives in [`supabase/migrations/0001_create_registry.sql`](supabase/migrations/0001_create_registry.sql):
  the `registry` table, its btree/GIN indexes, a generated `search_tsv`, an
  `updated_at` trigger, and an RLS policy allowing public `SELECT` only.
- The table is **seeded from the repo's example corpus** by
  [`tools/seed-registry.mjs`](../../tools/seed-registry.mjs), run from the repo root:

  ```bash
  # Needs the service-role key (writes bypass RLS). Never ship this key to the client.
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/seed-registry.mjs --apply
  ```

  Running it without `--apply` prints the idempotent upsert SQL to stdout instead.

- [`0001b_manufacturer_participation.sql`](supabase/migrations/0001b_manufacturer_participation.sql)
  and [`0001c_api_token_self_manage.sql`](supabase/migrations/0001c_api_token_self_manage.sql)
  are backfilled from production (manufacturer access requests, memberships, API
  tokens, and brand-scoped registry writes).
- [`0002_registry_sync.sql`](supabase/migrations/0002_registry_sync.sql) re-asserts
  the `updated_at` trigger (needed for `?updated_since=`) and adds the
  `registry_removals` tombstone table behind `GET /api/v1/removals`.
- [`0003_integration_requests.sql`](supabase/migrations/0003_integration_requests.sql)
  adds `integration_requests`, which holds software-vendor registrations
  (`/implement/register`) reviewed on `/admin`.
- [`0004_fix_manufacturer_grants.sql`](supabase/migrations/0004_fix_manufacturer_grants.sql)
  grants signed-in users the table privileges that 0001b's RLS policies assume.
  Without it, requesting brand access, listing brands, managing API tokens, and
  publishing from the site all fail with "permission denied".

All of these migrations are applied in production.

Registry records are licensed **CC BY 4.0** for downstream use. The terms live on
`/data-license`; their constants (license, terms version, sync and removal windows,
page-size limits) are in [`lib/data-license.ts`](lib/data-license.ts).

The website itself performs **no writes** — it only reads through the public anon key.
