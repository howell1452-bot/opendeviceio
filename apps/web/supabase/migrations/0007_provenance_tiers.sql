-- Provenance tiers, part 1 (submission & provenance tiers brief, items 1–2).
--
-- 1. Close the browser-side write path. Registry rows are written only by
--    server code using the service role: clients lose INSERT/UPDATE, the
--    brand-member write policies are dropped, and a guard trigger rejects any
--    write made as anon/authenticated (defense in depth). Brand scope is
--    re-checked in the route handlers before the service-role write.
-- 2. Source metadata, kept apart from verification:
--      registry.source_type   machine-draft | community | design-vendor | manufacturer
--      registry.source_org_id the submitting organization (vendors, brands)
--      registry.current_revision_id (FK added in 0008)
--    plus organizations / organization_members / contributor_status, and
--    brand_settings.community_submissions.
--
-- validation_status keeps its three values; the public API only gains fields.
-- Adding the columns does not touch rows (no updated_at bump); the backfill
-- only updates manufacturer-verified rows. Idempotent.

-- ---------------------------------------------------------------------------
-- Organizations (design vendors; optional labels for brands)
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('manufacturer', 'design-vendor')),
  name              text not null check (length(btrim(name)) between 1 and 200),
  slug              text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  website           text,
  verified_domains  text[] not null default '{}',
  status            text not null default 'pending'
                      check (status in ('pending', 'verified', 'suspended')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table if not exists public.organization_members (
  user_id     uuid not null references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  role        text not null default 'member' check (role in ('member', 'admin')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index if not exists organization_members_org_idx
  on public.organization_members (org_id);

create table if not exists public.contributor_status (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  trusted         boolean not null default false,
  accepted_count  integer not null default 0,
  suspended       boolean not null default false,
  note            text,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Registry source metadata (additive)
-- ---------------------------------------------------------------------------
alter table public.registry
  add column if not exists source_type text not null default 'machine-draft'
    check (source_type in ('machine-draft', 'community', 'design-vendor', 'manufacturer'));
alter table public.registry
  add column if not exists source_org_id uuid references public.organizations (id);
alter table public.registry
  add column if not exists current_revision_id uuid;   -- FK added in 0008

create index if not exists registry_source_type_idx on public.registry (source_type);

-- Backfill: verified rows came from manufacturers; everything else in the
-- registry today is a machine draft (or that draft, reviewed).
update public.registry
   set source_type = 'manufacturer'
 where validation_status = 'manufacturer-verified'
   and source_type <> 'manufacturer';

-- ---------------------------------------------------------------------------
-- Brand setting: community submissions
-- ---------------------------------------------------------------------------
alter table public.brand_settings
  add column if not exists community_submissions text not null default 'allowed'
    check (community_submissions in ('allowed', 'suggestions-only', 'blocked'));

-- ---------------------------------------------------------------------------
-- Close the browser-side write path (item 1)
-- ---------------------------------------------------------------------------
revoke insert, update on table public.registry from authenticated;
drop policy if exists "members insert own manufacturer" on public.registry;
drop policy if exists "members update own manufacturer" on public.registry;

-- Defense in depth: no registry write may run as a client role, whatever
-- grants or policies exist later. Server code writes with the service role;
-- migrations and SECURITY DEFINER functions run as the table owner.
create or replace function public.registry_reject_client_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'registry is written by the server only'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.registry_reject_client_writes() from public, anon, authenticated;

drop trigger if exists registry_reject_client_writes on public.registry;
create trigger registry_reject_client_writes
  before insert or update or delete on public.registry
  for each row execute function public.registry_reject_client_writes();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.contributor_status enable row level security;

-- Organizations: the public sees verified orgs only, and never their
-- verified_domains (column grants exclude it). Prefer the view below.
drop policy if exists "verified organizations are public" on public.organizations;
create policy "verified organizations are public"
  on public.organizations
  for select
  to anon, authenticated
  using (status = 'verified');

revoke all on table public.organizations from anon, authenticated;
grant select (id, kind, name, slug, website, status) on table public.organizations
  to anon, authenticated;

-- Created only if missing: 0010_brand_profiles.sql widens this view, and
-- "create or replace" with fewer columns would fail on a re-run.
do $$
begin
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'organizations_public') then
    create view public.organizations_public
      with (security_invoker = true) as
      select id, kind, name, slug, website
      from public.organizations
      where status = 'verified';
  end if;
end;
$$;

revoke all on table public.organizations_public from anon, authenticated;
grant select on table public.organizations_public to anon, authenticated;

-- Members read their own membership rows; writes go through the service role.
drop policy if exists "read own organization memberships" on public.organization_members;
create policy "read own organization memberships"
  on public.organization_members
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.organization_members from anon, authenticated;
grant select on table public.organization_members to authenticated;

-- Contributors read their own status; writes go through the service role.
drop policy if exists "read own contributor status" on public.contributor_status;
create policy "read own contributor status"
  on public.contributor_status
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.contributor_status from anon, authenticated;
grant select on table public.contributor_status to authenticated;

-- Admin role (cf. 0005a; default privileges also cover these).
grant select, insert, update, delete on table
  public.organizations,
  public.organization_members,
  public.contributor_status
to service_role;
grant select on table public.organizations_public to service_role;
