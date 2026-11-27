-- Registry sync support for downstream integrations (design / catalog software
-- that mirrors the registry).
--
-- 1. Re-asserts the updated_at trigger from 0001. The production database was
--    found without it, which means updated_at never moved on update and an
--    `updated_since` incremental sync would silently miss edits.
-- 2. Adds a removal feed (registry_removals): one tombstone per id that has
--    been deleted from (or renamed out of) the registry, so mirrors can honor
--    removals without a full re-download. A tombstone is cleared automatically
--    if the same id is published again (the mirror then sees it through
--    `updated_since` like any other change).
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
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

create index if not exists registry_updated_at_id_idx
  on public.registry (updated_at, id);
create index if not exists registry_validation_status_idx
  on public.registry (validation_status);

-- ---------------------------------------------------------------------------
-- 2. Removal feed
-- ---------------------------------------------------------------------------
create table if not exists public.registry_removals (
  seq          bigint generated always as identity primary key,
  id           text not null,                 -- the registry id that went away
  kind         text,
  manufacturer text,
  reason       text,                           -- optional, set by admins
  removed_at   timestamptz not null default now()
);

create index if not exists registry_removals_removed_at_idx
  on public.registry_removals (removed_at, seq);
create index if not exists registry_removals_id_idx
  on public.registry_removals (id);

-- Record a tombstone when a row is deleted, or when its id changes.
-- SECURITY DEFINER so the write succeeds whichever role touched `registry`
-- (service role, or a manufacturer under RLS); no client can write here directly.
create or replace function public.registry_record_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.registry_removals (id, kind, manufacturer)
    values (old.id, old.kind, old.manufacturer);
    return old;
  elsif tg_op = 'UPDATE' and new.id is distinct from old.id then
    insert into public.registry_removals (id, kind, manufacturer)
    values (old.id, old.kind, old.manufacturer);
  end if;
  return new;
end;
$$;

-- Clear a tombstone when the id comes back.
create or replace function public.registry_clear_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.registry_removals where id = new.id;
  return new;
end;
$$;

revoke all on function public.registry_record_removal() from public, anon, authenticated;
revoke all on function public.registry_clear_removal() from public, anon, authenticated;

drop trigger if exists registry_record_removal on public.registry;
create trigger registry_record_removal
  after delete or update of id on public.registry
  for each row execute function public.registry_record_removal();

drop trigger if exists registry_clear_removal on public.registry;
create trigger registry_clear_removal
  after insert or update of id on public.registry
  for each row execute function public.registry_clear_removal();

-- Public, read-only — same exposure as the registry itself.
alter table public.registry_removals enable row level security;

drop policy if exists "registry_removals public read" on public.registry_removals;
create policy "registry_removals public read"
  on public.registry_removals
  for select
  using (true);

grant select on table public.registry_removals to anon, authenticated;
