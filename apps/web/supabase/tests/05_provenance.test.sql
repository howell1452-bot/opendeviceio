-- Provenance tiers (0007, 0008, 0008a, 0008b): server-only registry writes,
-- revision rate limits and who can read which revisions.
\set ON_ERROR_STOP 1

create or replace function pg_temp.check(ok boolean, what text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok: %', what;
end $$;

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-000000000001', 'one@example.com'),
  ('b1000000-0000-4000-8000-000000000002', 'two@example.com')
on conflict do nothing;

insert into public.registry (id, kind, manufacturer, model, validation_status, document)
values ('prov-brand/p1', 'device', 'Prov Brand', 'P1', 'draft', '{}')
on conflict (id) do nothing;

-- 0007: no registry writes from client roles, whatever grants exist --------
set role authenticated;
set request.jwt.claim.sub = 'b1000000-0000-4000-8000-000000000001';
do $$ begin
  update public.registry set model = 'hacked' where id = 'prov-brand/p1';
  raise exception 'FAIL: a signed-in user updated the registry';
exception when insufficient_privilege then raise notice 'ok: signed-in users cannot write the registry';
end $$;
reset role;
reset request.jwt.claim.sub;

-- 0008 / 0008c: every row (including ones inserted later) has a revision ----
select pg_temp.check(
  not exists (select 1 from public.registry r where r.current_revision_id is null),
  'every registry row points at a current revision');
select pg_temp.check(
  (select count(*) from public.record_revisions x
     join public.registry r on r.current_revision_id = x.id
    where r.id = 'prov-brand/p1' and x.status = 'published' and x.submitted_by is null) = 1,
  'a row inserted outside the revision flow gets its first published revision');

-- 0008: rate limit -----------------------------------------------------------
do $$ begin
  for i in 1..20 loop
    insert into public.record_revisions (record_id, document, source_type, submitted_by, status)
    values ('prov-brand/p1', '{}', 'community', 'b1000000-0000-4000-8000-000000000001', 'pending');
  end loop;
end $$;
do $$ begin
  insert into public.record_revisions (record_id, document, source_type, submitted_by, status)
  values ('prov-brand/p1', '{}', 'community', 'b1000000-0000-4000-8000-000000000001', 'pending');
  raise exception 'FAIL: the 21st submission in an hour was accepted';
exception when raise_exception then
  if sqlerrm like 'rate_limited:%' then raise notice 'ok: the 21st submission in an hour is rate limited';
  else raise; end if;
end $$;

-- 0008a: a user reads only their own revisions -------------------------------
set role authenticated;
set request.jwt.claim.sub = 'b1000000-0000-4000-8000-000000000002';
select pg_temp.check(
  (select count(*) from public.record_revisions where status = 'pending') = 0,
  'a user cannot read another user''s pending revisions');
do $$ begin
  perform submitted_by from public.record_revisions limit 1;
  raise exception 'FAIL: a client read record_revisions.submitted_by';
exception when insufficient_privilege then raise notice 'ok: submitted_by is not readable by clients';
end $$;
reset role;
reset request.jwt.claim.sub;

-- 0008b: anon sees only published history of visible records ----------------
set role anon;
select pg_temp.check(
  (select count(*) from public.record_revisions where record_id = 'prov-brand/p1') = 1
  and (select bool_and(status in ('published', 'superseded')) from public.record_revisions),
  'anon sees published history only');
do $$ begin
  perform change_note from public.record_revisions limit 1;
  raise exception 'FAIL: anon read change notes';
exception when insufficient_privilege then raise notice 'ok: anon cannot read change notes';
end $$;
reset role;
