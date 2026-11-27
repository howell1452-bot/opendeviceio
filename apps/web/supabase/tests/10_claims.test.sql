-- Claim-your-brand (0010, 0011): RLS, grants and constraints on plain Postgres.
-- Each check raises on failure; run by run.sh after every migration.
\set ON_ERROR_STOP 1

create or replace function pg_temp.check(ok boolean, what text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok: %', what;
end $$;

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000001', 'rep@acme.example'),
  ('c1000000-0000-4000-8000-000000000002', 'someone@other.example')
on conflict do nothing;

insert into public.registry (id, kind, manufacturer, model, validation_status, document) values
  ('acme-devices/a1', 'device', 'Acme Devices', 'A1', 'draft', '{}'),
  ('acme-devices/a2', 'device', 'Acme Devices', 'A2', 'manufacturer-verified', '{}'),
  ('other-brand/b1', 'device', 'Other Brand', 'B1', 'draft', '{}')
on conflict (id) do nothing;

insert into public.manufacturer_members (user_id, manufacturer, role)
values ('c1000000-0000-4000-8000-000000000001', 'Acme Devices', 'brand-admin')
on conflict do nothing;

update public.organizations set verified_domains = '{acme.example}' where manufacturer = 'Acme Devices';
select public.admin_set_brand_hidden('Acme Devices', true, false, null, 'test');

-- 0010: one profile per brand ----------------------------------------------
select pg_temp.check(
  not exists (
    select 1 from (select distinct manufacturer from public.registry where manufacturer is not null) m
    where (select count(*) from public.organizations o where o.manufacturer = m.manufacturer) <> 1
  ),
  'every registry brand has exactly one organizations row');
select pg_temp.check(
  (select slug from public.organizations where manufacturer = 'Acme Devices') = 'acme-devices',
  'brand slug is the kebab-case manufacturer name');
select pg_temp.check(
  (select status = 'verified' and claimed_at is null from public.organizations where manufacturer = 'Other Brand'),
  'seeded brands start listed and unclaimed');

-- 0010: the public view never exposes verified_domains ----------------------
select pg_temp.check(
  not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'organizations_public'
                and column_name = 'verified_domains'),
  'organizations_public has no verified_domains column');

set role anon;
select pg_temp.check((select count(*) from public.organizations_public where slug = 'acme-devices') = 1,
  'anon reads brand profiles from organizations_public');
do $$ begin
  perform verified_domains from public.organizations limit 1;
  raise exception 'FAIL: anon read organizations.verified_domains';
exception when insufficient_privilege then raise notice 'ok: anon cannot read organizations.verified_domains';
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000002';
do $$ begin
  perform verified_domains from public.organizations limit 1;
  raise exception 'FAIL: a signed-in user read organizations.verified_domains';
exception when insufficient_privilege then raise notice 'ok: signed-in users cannot read organizations.verified_domains';
end $$;
reset role;
reset request.jwt.claim.sub;

-- 0011: claims go through the server ------------------------------------------
set role authenticated;
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000002';
do $$ begin
  insert into public.access_requests (user_id, manufacturer)
  values ('c1000000-0000-4000-8000-000000000002', 'Acme Devices');
  raise exception 'FAIL: a signed-in user inserted into access_requests through the Data API';
exception when insufficient_privilege then raise notice 'ok: client insert into access_requests is denied (42501)';
end $$;
do $$ begin
  perform 1 from public.brand_invites limit 1;
  raise exception 'FAIL: a signed-in user read brand_invites';
exception when insufficient_privilege then raise notice 'ok: brand_invites is closed to clients';
end $$;
reset role;
reset request.jwt.claim.sub;

-- Hidden drafts: members see them, nobody else does (0006 RLS) ---------------
set role authenticated;
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';
select pg_temp.check((select count(*) from public.registry where manufacturer = 'Acme Devices') = 2,
  'a brand member reads the brand''s hidden drafts');
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000002';
select pg_temp.check((select count(*) from public.registry where manufacturer = 'Acme Devices') = 1,
  'a non-member does not see the hidden drafts (verified record still visible)');
reset role;
reset request.jwt.claim.sub;
set role anon;
select pg_temp.check((select count(*) from public.registry where manufacturer = 'Acme Devices') = 1,
  'anon does not see the hidden drafts');
reset role;

-- 0011: one open claim per brand, 5 per day ----------------------------------
insert into public.access_requests (user_id, manufacturer, org_id)
select 'c1000000-0000-4000-8000-000000000002', 'Acme Devices', id from public.organizations where slug = 'acme-devices';
do $$ begin
  insert into public.access_requests (user_id, manufacturer, org_id)
  select 'c1000000-0000-4000-8000-000000000002', 'Acme Devices', id from public.organizations where slug = 'acme-devices';
  raise exception 'FAIL: a second open claim for the same brand was accepted';
exception when unique_violation then raise notice 'ok: one open claim per user per brand';
end $$;
do $$ begin
  for i in 1..4 loop
    insert into public.access_requests (user_id, manufacturer)
    values ('c1000000-0000-4000-8000-000000000002', 'brand ' || i);
  end loop;
  raise notice 'ok: claims 2-5 of the day accepted';
end $$;
do $$ begin
  insert into public.access_requests (user_id, manufacturer)
  values ('c1000000-0000-4000-8000-000000000002', 'brand 6');
  raise exception 'FAIL: a 6th claim in a day was accepted';
exception when raise_exception then
  if sqlerrm like 'rate_limited:%' then raise notice 'ok: the 6th claim in a day is rate limited';
  else raise; end if;
end $$;

-- 0010: roles --------------------------------------------------------------
do $$ begin
  update public.manufacturer_members set role = 'owner' where manufacturer = 'Acme Devices';
  raise exception 'FAIL: an unknown member role was accepted';
exception when check_violation then raise notice 'ok: member roles are publisher or brand-admin';
end $$;

-- 0010: brands that appear later get a profile -------------------------------
insert into public.registry (id, kind, manufacturer, model, validation_status, document)
values ('new-brand-co/x1', 'device', 'New Brand & Co', 'X1', 'draft', '{}');
select pg_temp.check(
  (select slug from public.organizations where manufacturer = 'New Brand & Co') = 'new-brand-and-co',
  'a new registry brand gets a profile row from the trigger');
