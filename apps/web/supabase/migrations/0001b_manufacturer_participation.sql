-- Backfilled from production (applied 2026-05-30 as `manufacturer_participation`,
-- version 20260530070733) so the repo reproduces the live schema. Unchanged.
--
-- NOTE: this migration grants no table privileges on manufacturer_members,
-- access_requests, or api_tokens, so the RLS policies below can never be
-- reached by signed-in users. 0004_fix_manufacturer_grants.sql corrects that.

-- Manufacturer participation: approved reps publish brand-scoped entries.

-- Which manufacturer(s) a user may publish for (admin-granted).
create table if not exists public.manufacturer_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  manufacturer text not null,
  role text not null default 'publisher',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (user_id, manufacturer)
);
alter table public.manufacturer_members enable row level security;
drop policy if exists "read own memberships" on public.manufacturer_members;
create policy "read own memberships" on public.manufacturer_members
  for select to authenticated using (auth.uid() = user_id);
-- (memberships are granted by an admin via the service role; no self-insert.)

-- A signed-in user's request to publish for a manufacturer (admin approves -> membership).
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  manufacturer text not null,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
drop policy if exists "insert own request" on public.access_requests;
create policy "insert own request" on public.access_requests
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "read own requests" on public.access_requests;
create policy "read own requests" on public.access_requests
  for select to authenticated using (auth.uid() = user_id);

-- Per-brand API tokens for programmatic upload (store only a hash).
create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.api_tokens enable row level security;
drop policy if exists "read own tokens" on public.api_tokens;
create policy "read own tokens" on public.api_tokens
  for select to authenticated using (auth.uid() = user_id);

-- Registry write access: authenticated members may upsert rows for THEIR manufacturer.
-- (Public SELECT policy + grant already exist; reads stay open, writes are brand-scoped.)
grant insert, update on table public.registry to authenticated;
drop policy if exists "members insert own manufacturer" on public.registry;
create policy "members insert own manufacturer" on public.registry
  for insert to authenticated
  with check (exists (
    select 1 from public.manufacturer_members m
    where m.user_id = auth.uid() and m.manufacturer = registry.manufacturer));
drop policy if exists "members update own manufacturer" on public.registry;
create policy "members update own manufacturer" on public.registry
  for update to authenticated
  using (exists (
    select 1 from public.manufacturer_members m
    where m.user_id = auth.uid() and m.manufacturer = registry.manufacturer))
  with check (exists (
    select 1 from public.manufacturer_members m
    where m.user_id = auth.uid() and m.manufacturer = registry.manufacturer));
