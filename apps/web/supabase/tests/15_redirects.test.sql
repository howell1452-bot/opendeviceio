-- Record id renames (0012): redirects, no removals, every reference moved.
\set ON_ERROR_STOP 1

create or replace function pg_temp.check(ok boolean, what text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok: %', what;
end $$;

-- Fixtures: two of the real old ids, as they exist before 0012 (each gets its
-- first revision from the 0008c trigger), and a record request that names one.
insert into public.registry (id, kind, manufacturer, model, validation_status, document) values
  ('attero-tech-by-qsc/axiom-ml1', 'device', 'Attero Tech', 'Axiom ML1', 'draft',
   '{"id":"attero-tech-by-qsc/axiom-ml1","device":{"manufacturer":"Attero Tech","model":"Axiom ML1"}}'),
  ('attero-tech-by-qsc/und6io', 'device', 'Attero Tech', 'unD6IO', 'draft',
   '{"id":"attero-tech-by-qsc/und6io","device":{"manufacturer":"Attero Tech","model":"unD6IO"}}');
insert into public.record_requests (request_type, record_ids, name, company, email, details)
values ('correction', array['attero-tech-by-qsc/axiom-ml1', 'other/x'], 'Test', 'Test Co', 'someone@example.com', 'test');

create temp table removals_before as select count(*) as n from public.registry_removals;

-- Re-run the real migration over them.
\ir ../migrations/0012_record_id_redirects.sql

select pg_temp.check(
  not exists (select 1 from public.registry where id like 'attero-tech-by-qsc/%'),
  'no registry id starts with attero-tech-by-qsc/');
select pg_temp.check(
  (select count(*) from public.registry where id in ('attero-tech/axiom-ml1', 'attero-tech/und6io')) = 2,
  'the records live under attero-tech/');
select pg_temp.check(
  (select document->>'id' from public.registry where id = 'attero-tech/axiom-ml1') = 'attero-tech/axiom-ml1',
  'the stored document''s id is renamed too');
select pg_temp.check(
  (select count(*) from public.record_redirects
    where (old_id, new_id) in (('attero-tech-by-qsc/axiom-ml1', 'attero-tech/axiom-ml1'),
                               ('attero-tech-by-qsc/und6io', 'attero-tech/und6io'))) = 2,
  'redirect rows exist for both');
select pg_temp.check(
  not exists (select 1 from public.record_revisions where record_id like 'attero-tech-by-qsc/%')
  and (select count(*) from public.record_revisions x
         join public.registry r on r.current_revision_id = x.id
        where r.id = 'attero-tech/axiom-ml1' and x.record_id = r.id
          and x.document->>'id' = r.id) = 1,
  'revisions moved with the record (record_id and document id)');
select pg_temp.check(
  (select record_ids from public.record_requests where details = 'test') = array['attero-tech/axiom-ml1', 'other/x'],
  'record requests point at the new id');
select pg_temp.check(
  (select count(*) from public.registry_removals) = (select n from removals_before)
  and not exists (select 1 from public.registry_removals where id like 'attero-tech-by-qsc/%'),
  'a rename adds nothing to the removals feed');

-- Idempotent: a third run changes nothing.
\ir ../migrations/0012_record_id_redirects.sql
select pg_temp.check(
  (select count(*) from public.record_redirects where old_id like 'attero-tech-by-qsc/%') = 2,
  'running the migration again changes nothing');

-- A collision aborts instead of overwriting.
insert into public.registry (id, kind, manufacturer, model, validation_status, document) values
  ('old-prefix/x1', 'device', 'Acme', 'X1', 'draft', '{"id":"old-prefix/x1"}'),
  ('new-prefix/x1', 'device', 'Acme', 'X1', 'draft', '{"id":"new-prefix/x1"}');
do $$ begin
  perform private.rename_record_id('old-prefix/x1', 'new-prefix/x1');
  raise exception 'FAIL: a rename onto an existing id went through';
exception when raise_exception then
  if sqlerrm like 'rename_record_id: target id % already exists%' then
    raise notice 'ok: a rename onto an existing id is refused';
  else raise; end if;
end $$;

-- A plain delete is still a removal.
delete from public.registry where id = 'old-prefix/x1';
select pg_temp.check(
  exists (select 1 from public.registry_removals where id = 'old-prefix/x1'),
  'deleting a record still publishes a removal');

-- Public read, no client writes.
set role anon;
select pg_temp.check((select count(*) from public.record_redirects) >= 2, 'anon can read record_redirects');
do $$ begin
  insert into public.record_redirects (old_id, new_id) values ('a/b', 'c/d');
  raise exception 'FAIL: anon wrote record_redirects';
exception when insufficient_privilege then raise notice 'ok: anon cannot write record_redirects';
end $$;
reset role;
set role authenticated;
do $$ begin
  delete from public.record_redirects;
  raise exception 'FAIL: a signed-in user deleted record_redirects';
exception when insufficient_privilege then raise notice 'ok: signed-in users cannot write record_redirects';
end $$;
reset role;
