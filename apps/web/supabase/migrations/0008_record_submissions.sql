-- Provenance tiers, part 2 (submission & provenance tiers brief, item 3).
--
-- record_revisions holds every version of every registry record: the seeded
-- machine drafts (backfilled here, one 'published' revision per row), community
-- and design-vendor submissions, and manufacturer publishes. registry keeps
-- serving the current version and points at it with current_revision_id.
--
-- Revision status:
--   pending     waiting in the moderation queue (/admin)
--   published   the live version of its record
--   suggested   a proposed change to a record the submitter may not overwrite
--               (verified / reviewed / brand-controlled / removed on request)
--   accepted    a suggestion a brand or admin took (re-published separately)
--   rejected    declined by a brand or admin
--   superseded  was published; a newer revision replaced it
--   withdrawn   abandoned (e.g. the registry write after it failed)
--
-- Writes go through server code with the service role only. Clients can read
-- their own revisions, and brand members can read revisions for their brand;
-- neither sees submitted_by or reviewer. The public revision history is served
-- by the API from published/superseded rows with no submitter identity.
--
-- Rate limits (starting numbers; adjust the constants below):
--   community, per user:          20 per hour, 100 per day
--   community, untrusted users:   5 new record ids per day
--   community, everyone combined: 300 per 10 minutes
--   design-vendor, per org:       500 per day
--   suspended users:              rejected
-- Manufacturer publishes and system rows (submitted_by null) are not limited.
--
-- The backfill only sets registry.current_revision_id. The registry
-- updated_at trigger is refined so that a pointer-only change does not bump
-- updated_at (mirrors syncing with updated_since would otherwise re-download
-- every row). Idempotent.

-- ---------------------------------------------------------------------------
-- record_revisions
-- ---------------------------------------------------------------------------
create table if not exists public.record_revisions (
  id                uuid primary key default gen_random_uuid(),
  record_id         text not null check (length(record_id) between 1 and 300),
  document          jsonb not null,
  manufacturer      text,                         -- normalized; routes suggestions to the brand
  source_type       text not null
                      check (source_type in ('machine-draft', 'community', 'design-vendor', 'manufacturer')),
  source_org_id     uuid references public.organizations (id) on delete set null,
  submitted_by      uuid references auth.users (id) on delete set null,  -- null for seed/machine
  status            text not null default 'pending'
                      check (status in ('pending', 'published', 'suggested', 'accepted',
                                        'rejected', 'superseded', 'withdrawn')),
  base_revision_id  uuid references public.record_revisions (id) on delete set null,
  is_new_record     boolean not null default false,  -- the id was not in the registry when submitted
  change_note       text check (change_note is null or length(change_note) <= 2000),
  terms_version     text,                         -- contributor terms the submitter accepted
  reviewer          text,                         -- 'OpenDeviceIO' or the brand name; never a person
  reviewed_at       timestamptz,
  review_note       text check (review_note is null or length(review_note) <= 2000),
  created_at        timestamptz not null default now()
);

create index if not exists record_revisions_record_idx
  on public.record_revisions (record_id, created_at desc);
create index if not exists record_revisions_status_idx
  on public.record_revisions (status, created_at);
create index if not exists record_revisions_submitter_idx
  on public.record_revisions (submitted_by, created_at)
  where submitted_by is not null;
create index if not exists record_revisions_org_idx
  on public.record_revisions (source_org_id, created_at)
  where source_org_id is not null;
create index if not exists record_revisions_manufacturer_idx
  on public.record_revisions (manufacturer, status);
create index if not exists record_revisions_created_idx
  on public.record_revisions (created_at);
create index if not exists record_revisions_base_idx
  on public.record_revisions (base_revision_id)
  where base_revision_id is not null;

-- registry.current_revision_id -> record_revisions(id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'registry_current_revision_id_fkey'
      and conrelid = 'public.registry'::regclass
  ) then
    alter table public.registry
      add constraint registry_current_revision_id_fkey
      foreign key (current_revision_id) references public.record_revisions (id)
      on delete set null;
  end if;
end;
$$;
create index if not exists registry_current_revision_idx
  on public.registry (current_revision_id);
create index if not exists registry_source_org_idx
  on public.registry (source_org_id)
  where source_org_id is not null;

-- ---------------------------------------------------------------------------
-- registry.updated_at: a change to current_revision_id alone is bookkeeping,
-- not a content change, so it keeps updated_at. Every other update (including
-- an explicit `set updated_at = now()`, as un-hiding a brand does) behaves as
-- before.
-- ---------------------------------------------------------------------------
create or replace function public.registry_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.current_revision_id is distinct from old.current_revision_id
     and (to_jsonb(new) - 'current_revision_id' - 'updated_at' - 'search_tsv')
       = (to_jsonb(old) - 'current_revision_id' - 'updated_at' - 'search_tsv') then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.registry_set_updated_at() from public, anon, authenticated;

drop trigger if exists registry_set_updated_at on public.registry;
create trigger registry_set_updated_at
  before update on public.registry
  for each row execute function public.registry_set_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill: one published revision per existing registry row, so history
-- starts now. created_at is the row's last update.
-- ---------------------------------------------------------------------------
insert into public.record_revisions
  (record_id, document, manufacturer, source_type, source_org_id, status, created_at)
select r.id, r.document, r.manufacturer, r.source_type, r.source_org_id, 'published', r.updated_at
from public.registry r
where r.current_revision_id is null
  and r.document is not null
  and not exists (
    select 1 from public.record_revisions x
    where x.record_id = r.id and x.status = 'published'
  );

update public.registry r
   set current_revision_id = x.id
  from public.record_revisions x
 where r.current_revision_id is null
   and x.record_id = r.id
   and x.status = 'published';

-- ---------------------------------------------------------------------------
-- Rate limits. SECURITY DEFINER so it can count rows regardless of who
-- inserts (in practice the service role).
-- ---------------------------------------------------------------------------
create or replace function public.record_revisions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Starting numbers (brief item 3); adjust here.
  c_user_per_hour       constant integer := 20;
  c_user_per_day        constant integer := 100;
  c_untrusted_new_ids   constant integer := 5;
  c_global_per_10min    constant integer := 300;
  c_org_per_day         constant integer := 500;
  v_trusted   boolean;
  v_suspended boolean;
begin
  if new.submitted_by is null or new.source_type in ('manufacturer', 'machine-draft') then
    return new;
  end if;

  select c.trusted, c.suspended into v_trusted, v_suspended
    from public.contributor_status c
   where c.user_id = new.submitted_by;
  v_trusted := coalesce(v_trusted, false);
  v_suspended := coalesce(v_suspended, false);

  if v_suspended then
    raise exception 'suspended: this account can no longer submit records'
      using errcode = 'P0001';
  end if;

  if new.source_type = 'design-vendor' then
    if new.source_org_id is not null and (
         select count(*) from public.record_revisions
          where source_org_id = new.source_org_id
            and source_type = 'design-vendor'
            and created_at > now() - interval '1 day') >= c_org_per_day then
      raise exception 'rate_limited: your organization has reached % submissions in 24 hours; try again later', c_org_per_day
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- community
  if (select count(*) from public.record_revisions
       where submitted_by = new.submitted_by
         and source_type = 'community'
         and created_at > now() - interval '1 hour') >= c_user_per_hour then
    raise exception 'rate_limited: you can submit % records per hour; try again later', c_user_per_hour
      using errcode = 'P0001';
  end if;
  if (select count(*) from public.record_revisions
       where submitted_by = new.submitted_by
         and source_type = 'community'
         and created_at > now() - interval '1 day') >= c_user_per_day then
    raise exception 'rate_limited: you can submit % records per day; try again tomorrow', c_user_per_day
      using errcode = 'P0001';
  end if;
  if new.is_new_record and not v_trusted and (
       select count(*) from public.record_revisions
        where submitted_by = new.submitted_by
          and source_type = 'community'
          and is_new_record
          and created_at > now() - interval '1 day') >= c_untrusted_new_ids then
    raise exception 'rate_limited: new contributors can add % new records per day; edits to existing records are still accepted', c_untrusted_new_ids
      using errcode = 'P0001';
  end if;
  if (select count(*) from public.record_revisions
       where source_type = 'community'
         and created_at > now() - interval '10 minutes') >= c_global_per_10min then
    raise exception 'rate_limited: the submission queue is busy; try again in a few minutes'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.record_revisions_rate_limit() from public, anon, authenticated;

drop trigger if exists record_revisions_rate_limit on public.record_revisions;
create trigger record_revisions_rate_limit
  before insert on public.record_revisions
  for each row execute function public.record_revisions_rate_limit();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.record_revisions enable row level security;

drop policy if exists "submitters read own revisions" on public.record_revisions;
create policy "submitters read own revisions"
  on public.record_revisions
  for select
  to authenticated
  using (submitted_by = (select auth.uid()));

drop policy if exists "brand members read brand revisions" on public.record_revisions;
create policy "brand members read brand revisions"
  on public.record_revisions
  for select
  to authenticated
  using (manufacturer is not null and private.is_brand_member(manufacturer));

-- No client writes. Reads exclude submitted_by and reviewer.
revoke all on table public.record_revisions from anon, authenticated;
grant select (id, record_id, document, manufacturer, source_type, source_org_id, status,
              base_revision_id, is_new_record, change_note, terms_version, reviewed_at,
              review_note, created_at)
  on table public.record_revisions to authenticated;
grant select, insert, update, delete on table public.record_revisions to service_role;
