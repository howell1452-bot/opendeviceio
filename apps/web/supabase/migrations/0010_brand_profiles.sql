-- Brand profiles (claim-your-brand brief, item 1).
--
-- public.organizations (0007) with kind = 'manufacturer' becomes the brand
-- profile: one row per registry brand, linked by organizations.manufacturer
-- (the canonical registry.manufacturer, same normalizeManufacturer() as the
-- registry). Every brand starts unclaimed (claimed_at null) and listed
-- (status 'verified', so organizations_public shows it). A brand is claimed
-- when an admin approves its first member (manufacturer_members stays the
-- source of truth for write scope).
--
-- New public profile fields, all optional and set by the brand:
-- description (<= 600 chars), support_url, data_contact (a public product-data
-- contact, only if the brand enters one). verified_domains stays private.
--
-- manufacturer_members.role: 'publisher' (default, all existing rows) or
-- 'brand-admin' (manages the team, settings and profile).
--
-- Brands that appear in the registry later (seed, submissions) get their
-- profile row from a trigger, so every registry brand always has exactly one.
-- 0009 is reserved for record images (provenance brief). Idempotent.

-- ---------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------
alter table public.organizations add column if not exists manufacturer text;
alter table public.organizations add column if not exists claimed_at timestamptz;
alter table public.organizations add column if not exists description text;
alter table public.organizations add column if not exists support_url text;
alter table public.organizations add column if not exists data_contact text;

create unique index if not exists organizations_manufacturer_key
  on public.organizations (manufacturer)
  where manufacturer is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_description_len'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_description_len
      check (description is null or length(description) <= 600);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_support_url_http'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_support_url_http
      check (support_url is null or support_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_data_contact_len'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_data_contact_len
      check (data_contact is null or length(data_contact) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_manufacturer_kind'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_manufacturer_kind
      check (manufacturer is null or kind = 'manufacturer');
  end if;
end;
$$;

-- manufacturer_members.role: publisher | brand-admin
update public.manufacturer_members set role = 'publisher'
 where role is null or role not in ('publisher', 'brand-admin');
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'manufacturer_members_role_check'
                 and conrelid = 'public.manufacturer_members'::regclass) then
    alter table public.manufacturer_members add constraint manufacturer_members_role_check
      check (role in ('publisher', 'brand-admin'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- One profile per brand
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- URL slug of a brand name: "Stem Audio" -> "stem-audio". (lib/submission-doc.ts
-- manufacturerSlug() is the TypeScript twin for ids; slugs are stored, so
-- lookups never recompute them.)
create or replace function private.brand_slug(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(replace(lower(coalesce(p_name, '')), '&', ' and '),
                                           '[^a-z0-9]+', '-', 'g'));
$$;

-- The brand's profile row, created (unclaimed, listed) if missing. A slug
-- already taken by another organization gets a short stable suffix.
create or replace function private.ensure_brand_org(p_manufacturer text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_base text;
  v_slug text;
begin
  if p_manufacturer is null or btrim(p_manufacturer) = '' then
    return null;
  end if;
  select id into v_id from public.organizations where manufacturer = p_manufacturer;
  if v_id is not null then
    return v_id;
  end if;
  v_base := private.brand_slug(p_manufacturer);
  if v_base = '' then
    v_base := 'brand';
  end if;
  v_slug := v_base;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_base || '-' || substr(md5(p_manufacturer), 1, 6);
  end if;
  insert into public.organizations (kind, name, slug, manufacturer, status)
  values ('manufacturer', left(btrim(p_manufacturer), 200), v_slug, p_manufacturer, 'verified')
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.organizations where manufacturer = p_manufacturer;
  end if;
  return v_id;
end;
$$;

revoke all on function private.brand_slug(text) from public;
revoke all on function private.ensure_brand_org(text) from public;

-- Seed: every brand in the registry today.
select private.ensure_brand_org(m.manufacturer)
  from (select distinct manufacturer from public.registry) m
 where m.manufacturer is not null;

-- Keep it that way as brands arrive.
create or replace function public.registry_ensure_brand_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.ensure_brand_org(new.manufacturer);
  return new;
end;
$$;

revoke all on function public.registry_ensure_brand_org() from public, anon, authenticated;

drop trigger if exists registry_ensure_brand_org on public.registry;
create trigger registry_ensure_brand_org
  after insert or update of manufacturer on public.registry
  for each row execute function public.registry_ensure_brand_org();

-- ---------------------------------------------------------------------------
-- Public view and grants (never verified_domains)
-- ---------------------------------------------------------------------------
revoke all on table public.organizations from anon, authenticated;
grant select (id, kind, name, slug, website, status, manufacturer, claimed_at,
              description, support_url, data_contact)
  on table public.organizations to anon, authenticated;

create or replace view public.organizations_public
  with (security_invoker = true) as
  select id, kind, name, slug, website,
         description, support_url, data_contact, manufacturer, claimed_at
  from public.organizations
  where status = 'verified';

revoke all on table public.organizations_public from anon, authenticated;
grant select on table public.organizations_public to anon, authenticated;
grant select, insert, update, delete on table public.organizations to service_role;
grant select on table public.organizations_public to service_role;
