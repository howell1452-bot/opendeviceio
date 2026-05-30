-- OpenDeviceIO registry table.
--
-- A read-only public catalog of .odio.json documents (device | bundle | cable).
-- Each row is keyed by the ODIO id (e.g. "lightware/ucx-4x2-hc60d") and stores
-- the full document plus extracted metadata for search and filtering.
--
-- Public (anon) access is SELECT-only via Row Level Security; writes are
-- performed out-of-band by the seed tool using the service-role key
-- (tools/seed-registry.mjs --apply), which bypasses RLS.

create table if not exists public.registry (
  id                text primary key,                      -- "manufacturer/model[@rev]"
  kind              text not null default 'device'
                      check (kind in ('device', 'bundle', 'cable')),
  manufacturer      text,
  model             text,
  category          text,
  product_line      text,
  sku               text,
  validation_status text
                      check (validation_status in ('draft', 'reviewed', 'manufacturer-verified')),
  odio_version      text,
  port_count        integer,
  connectors        text[] not null default '{}',
  transports        text[] not null default '{}',
  document          jsonb not null,                        -- the full .odio.json
  -- Generated full-text search vector over the human-meaningful fields.
  search_tsv        tsvector generated always as (
                      to_tsvector('simple',
                        coalesce(manufacturer, '') || ' ' ||
                        coalesce(model, '')        || ' ' ||
                        coalesce(category, '')     || ' ' ||
                        coalesce(product_line, '') || ' ' ||
                        coalesce(sku, '')          || ' ' ||
                        coalesce(id, ''))
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Indexes for the browse/filter UI.
create index if not exists registry_manufacturer_lower_idx
  on public.registry (lower(manufacturer));
create index if not exists registry_category_idx
  on public.registry (category);
create index if not exists registry_kind_idx
  on public.registry (kind);
create index if not exists registry_connectors_gin
  on public.registry using gin (connectors);
create index if not exists registry_transports_gin
  on public.registry using gin (transports);
create index if not exists registry_search_gin
  on public.registry using gin (search_tsv);

-- Keep updated_at current on every write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists registry_set_updated_at on public.registry;
create trigger registry_set_updated_at
  before update on public.registry
  for each row execute function public.set_updated_at();

-- Row Level Security: public may read, nobody may write through the anon/auth roles.
alter table public.registry enable row level security;

drop policy if exists "registry public read" on public.registry;
create policy "registry public read"
  on public.registry
  for select
  using (true);

-- Table-level privilege for the public API roles. RLS only filters rows a role
-- has already been GRANTed access to; without this SELECT grant every anon query
-- is "permission denied" regardless of the policy above. No INSERT/UPDATE/DELETE
-- grant is given, so the catalog stays read-only through the publishable key.
grant select on table public.registry to anon, authenticated;
