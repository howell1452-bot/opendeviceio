-- Per-brand "hidden until opt-in" flag.
--
-- An admin can hide a brand's UNVERIFIED DRAFTS from everything public (the
-- registry UI, the list / by-id / download APIs, facets) without deleting
-- them. Reviewed and manufacturer-verified records stay visible. Members of
-- the brand (manufacturer_members) still see their own hidden drafts so they
-- can verify and re-publish them; publishing makes a record
-- manufacturer-verified, which is visible again.
--
-- Hiding can optionally publish the hidden drafts to the removal feed
-- (registry_removals) so mirrors delete their copies. Un-hiding bumps the
-- drafts' updated_at so mirrors pick them up again, and the clear-tombstone
-- trigger drops their removal entries.
--
-- Nothing is hidden by default. Idempotent.

-- ---------------------------------------------------------------------------
-- Settings table (admin only)
-- ---------------------------------------------------------------------------
create table if not exists public.brand_settings (
  manufacturer         text primary key,           -- normalized registry.manufacturer
  hidden_until_opt_in  boolean not null default false,
  note                 text,
  updated_by           text,
  updated_at           timestamptz not null default now()
);

alter table public.brand_settings enable row level security;
-- No policies and no client grants: read and written only by the service role.
revoke all on table public.brand_settings from anon, authenticated;
grant select, insert, update, delete on table public.brand_settings to service_role;

-- ---------------------------------------------------------------------------
-- Policy helpers in a schema the Data API does not expose (so they cannot be
-- called as RPCs). SECURITY DEFINER so RLS can consult tables clients can't read.
-- ---------------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.brand_drafts_hidden(p_manufacturer text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brand_settings b
    where b.manufacturer = p_manufacturer and b.hidden_until_opt_in
  );
$$;

-- True when any brand is hidden. Wrapped as `(select ...)` in the policy so it
-- runs once per query (an InitPlan): with nothing hidden, the per-row checks
-- below are skipped entirely.
create or replace function private.any_brand_hidden()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.brand_settings b where b.hidden_until_opt_in);
$$;

create or replace function private.is_brand_member(p_manufacturer text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.manufacturer_members m
    where m.user_id = auth.uid() and m.manufacturer = p_manufacturer
  );
$$;

revoke all on function private.any_brand_hidden() from public;
grant execute on function private.any_brand_hidden() to anon, authenticated;
revoke all on function private.brand_drafts_hidden(text) from public;
revoke all on function private.is_brand_member(text) from public;
grant execute on function private.brand_drafts_hidden(text) to anon, authenticated;
grant execute on function private.is_brand_member(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registry read policy: hidden brands' drafts disappear for everyone but the
-- brand's own members. (Replaces the unconditional public-read policy; the
-- production policy was named "public read registry", the repo's 0001 used
-- "registry public read".)
-- ---------------------------------------------------------------------------
drop policy if exists "public read registry" on public.registry;
drop policy if exists "registry public read" on public.registry;
create policy "registry public read"
  on public.registry
  for select
  using (
    coalesce(validation_status, 'draft') <> 'draft'
    or not (select private.any_brand_hidden())
    or not private.brand_drafts_hidden(manufacturer)
    or private.is_brand_member(manufacturer)
  );

-- ---------------------------------------------------------------------------
-- Removal-feed bookkeeping: a tombstone is cleared whenever its record is
-- (again) publicly visible — on insert, or on any update that leaves it
-- visible (e.g. un-hiding, or a hidden draft re-published as verified).
-- Supersedes the insert-only version from 0002.
-- ---------------------------------------------------------------------------
create or replace function public.registry_clear_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.validation_status, 'draft') <> 'draft'
     or not private.brand_drafts_hidden(new.manufacturer) then
    delete from public.registry_removals where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.registry_clear_removal() from public, anon, authenticated;

drop trigger if exists registry_clear_removal on public.registry;
create trigger registry_clear_removal
  after insert or update on public.registry
  for each row execute function public.registry_clear_removal();

-- ---------------------------------------------------------------------------
-- Admin functions (service role only; called from /admin). SECURITY DEFINER,
-- with EXECUTE granted to service_role alone.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_brand_hidden(
  p_manufacturer text,
  p_hidden boolean,
  p_publish_removals boolean default false,
  p_note text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_drafts integer;
  n_tombstones integer := 0;
begin
  insert into public.brand_settings (manufacturer, hidden_until_opt_in, note, updated_by, updated_at)
  values (p_manufacturer, p_hidden, p_note, p_actor, now())
  on conflict (manufacturer) do update
    set hidden_until_opt_in = excluded.hidden_until_opt_in,
        note = coalesce(excluded.note, public.brand_settings.note),
        updated_by = excluded.updated_by,
        updated_at = now();

  select count(*) into n_drafts
  from public.registry
  where manufacturer = p_manufacturer and coalesce(validation_status, 'draft') = 'draft';

  if p_hidden and p_publish_removals then
    insert into public.registry_removals (id, kind, manufacturer, reason)
    select r.id, r.kind, r.manufacturer, 'Hidden on request'
    from public.registry r
    where r.manufacturer = p_manufacturer
      and coalesce(r.validation_status, 'draft') = 'draft'
      and not exists (select 1 from public.registry_removals x where x.id = r.id);
    get diagnostics n_tombstones = row_count;
  elsif not p_hidden then
    -- Visible again: bump updated_at so mirrors re-fetch; the clear trigger
    -- drops any removal entries for these rows.
    update public.registry
      set updated_at = now()
      where manufacturer = p_manufacturer
        and coalesce(validation_status, 'draft') = 'draft';
  end if;

  return jsonb_build_object('drafts', n_drafts, 'tombstones', n_tombstones);
end;
$$;

create or replace function public.admin_brand_overview()
returns table (
  manufacturer text,
  drafts bigint,
  reviewed bigint,
  verified bigint,
  hidden boolean,
  note text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.manufacturer,
         count(*) filter (where coalesce(r.validation_status, 'draft') = 'draft'),
         count(*) filter (where r.validation_status = 'reviewed'),
         count(*) filter (where r.validation_status = 'manufacturer-verified'),
         coalesce(b.hidden_until_opt_in, false),
         b.note,
         b.updated_at
  from public.registry r
  left join public.brand_settings b on b.manufacturer = r.manufacturer
  where r.manufacturer is not null
  group by r.manufacturer, b.hidden_until_opt_in, b.note, b.updated_at
  order by count(*) desc, r.manufacturer;
$$;

revoke all on function public.admin_set_brand_hidden(text, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.admin_brand_overview() from public, anon, authenticated;
grant execute on function public.admin_set_brand_hidden(text, boolean, boolean, text, text) to service_role;
grant execute on function public.admin_brand_overview() to service_role;
