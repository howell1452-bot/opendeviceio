-- Record id cleanup and the id prefix guard (0013): renames, merges, no
-- removals, history kept, and the id_prefix_mismatch trigger.
\set ON_ERROR_STOP 1

create or replace function pg_temp.check(ok boolean, what text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok: %', what;
end $$;

-- Fixtures: some of the real off-slug ids, as they exist before 0013 (each gets
-- its first revision from the 0008c trigger). The guard is off while they're
-- inserted, since it rejects exactly these.
alter table public.registry disable trigger registry_id_prefix_check;
insert into public.registry (id, kind, manufacturer, model, category, validation_status, port_count, connectors, document) values
  -- a rename
  ('qsys/nl-p4', 'device', 'QSC', 'NL-P4', 'av/loudspeaker/pendant', 'draft', 1, '{speakon-nl4}',
   '{"id":"qsys/nl-p4","device":{"manufacturer":"QSC","model":"NL-P4"},"ports":[{"id":"in","connector":"speakon-nl4"}]}'),
  -- a merge that takes the loser's (more complete) document
  ('usl/cm-10b', 'device', 'USL', 'CM-10B', 'av/monitor/booth', 'draft', 1, '{xlr-3-f}',
   '{"id":"usl/cm-10b","device":{"manufacturer":"USL","model":"CM-10B","category":"av/monitor/booth"},"ports":[{"id":"a","connector":"xlr-3-f"}]}'),
  ('uslinc/cm-10b', 'device', 'USL', 'CM-10B', 'av/monitor/booth', 'draft', 3, '{iec-c14,rj45,xlr-3-f}',
   '{"id":"uslinc/cm-10b","device":{"manufacturer":"USL","model":"CM-10B","category":"av/monitor/booth","productLine":"CM Series"},"ports":[{"id":"a","connector":"xlr-3-f","signals":[{"transport":"analog"}]},{"id":"b","connector":"rj45","signals":[{"transport":"control-network"}]},{"id":"c","connector":"xlr-3-f"}],"power":{"inputs":[{"type":"ac","connector":"iec-c14"}]}}'),
  -- a merge that keeps the survivor's document and copies the power block
  ('qsc/ad-c6t-zb', 'device', 'QSC', 'AD-C6T-ZB', 'av/loudspeaker/ceiling', 'draft', 2, '{phoenix-2}',
   '{"id":"qsc/ad-c6t-zb","device":{"manufacturer":"QSC","model":"AD-C6T-ZB"},"ports":[{"id":"in","connector":"phoenix-2"},{"id":"thru","connector":"phoenix-2"}]}'),
  ('qsys/ad-c6t-zb', 'device', 'QSC', 'AD-C6T-ZB', 'av/speaker/ceiling', 'draft', 1, '{phoenix-2}',
   '{"id":"qsys/ad-c6t-zb","device":{"manufacturer":"QSC","model":"AD-C6T-ZB"},"ports":[{"id":"in","connector":"phoenix-2"}],"power":{"consumptionWatts":{"max":6}}}'),
  -- a merge that normalizes the category
  ('usl/dat-100', 'device', 'USL', 'DAT-100', 'av/test-equipment/audio-generator', 'draft', 0, '{}',
   '{"id":"usl/dat-100","device":{"manufacturer":"USL","model":"DAT-100","category":"av/test-equipment/audio-generator"},"ports":[]}'),
  ('us-linc/dat-100', 'device', 'USL', 'DAT-100', 'av/audio/tester', 'draft', 0, '{}',
   '{"id":"us-linc/dat-100","device":{"manufacturer":"USL","model":"DAT-100","category":"av/audio/tester"},"ports":[]}');
alter table public.registry enable trigger registry_id_prefix_check;

-- An open suggestion on a duplicate, and record requests naming old ids.
insert into public.record_revisions (record_id, document, manufacturer, source_type, status)
values ('uslinc/cm-10b', '{"id":"uslinc/cm-10b","device":{"manufacturer":"USL","model":"CM-10B"},"ports":[]}',
        'USL', 'community', 'suggested');
insert into public.record_requests (request_type, record_ids, name, company, email, details) values
  ('correction', array['qsys/nl-p4'], 'Test', 'Test Co', 'a@example.com', 'idc rename'),
  ('correction', array['uslinc/cm-10b', 'usl/cm-10b'], 'Test', 'Test Co', 'b@example.com', 'idc merge');

create temp table removals_before as select count(*) as n from public.registry_removals;
create temp table cm_survivor_rev as
  select current_revision_id as id from public.registry where id = 'usl/cm-10b';
create temp table cm_loser_rev as
  select current_revision_id as id from public.registry where id = 'uslinc/cm-10b';

\ir ../migrations/0013_record_id_cleanup.sql

-- ---- rename ------------------------------------------------------------------
select pg_temp.check(
  not exists (select 1 from public.registry where id = 'qsys/nl-p4')
  and (select document->>'id' from public.registry where id = 'qsc/nl-p4') = 'qsc/nl-p4',
  'rename: qsys/nl-p4 is qsc/nl-p4, document id included');
select pg_temp.check(
  exists (select 1 from public.record_redirects where old_id = 'qsys/nl-p4' and new_id = 'qsc/nl-p4'),
  'rename: redirect row');
select pg_temp.check(
  (select record_ids from public.record_requests where details = 'idc rename') = array['qsc/nl-p4'],
  'rename: record requests point at the new id');

-- ---- merge, loser's document ------------------------------------------------
select pg_temp.check(
  not exists (select 1 from public.registry where id = 'uslinc/cm-10b')
  and exists (select 1 from public.record_redirects where old_id = 'uslinc/cm-10b' and new_id = 'usl/cm-10b'),
  'merge: the duplicate is gone and redirects to the survivor');
select pg_temp.check(
  (select port_count from public.registry where id = 'usl/cm-10b') = 3
  and (select jsonb_array_length(document->'ports') from public.registry where id = 'usl/cm-10b') = 3
  and (select document->>'id' from public.registry where id = 'usl/cm-10b') = 'usl/cm-10b'
  and (select product_line from public.registry where id = 'usl/cm-10b') = 'CM Series',
  'merge: the survivor carries the more complete document under its own id');
select pg_temp.check(
  (select connectors from public.registry where id = 'usl/cm-10b') = array['iec-c14', 'rj45', 'xlr-3-f']
  and (select transports from public.registry where id = 'usl/cm-10b') = array['analog', 'control-network'],
  'merge: connectors and transports are derived from the merged document');
select pg_temp.check(
  (select x.change_note from public.registry r join public.record_revisions x on x.id = r.current_revision_id
    where r.id = 'usl/cm-10b') = 'merged from uslinc/cm-10b'
  and (select x.status from public.registry r join public.record_revisions x on x.id = r.current_revision_id
    where r.id = 'usl/cm-10b') = 'published'
  and (select count(*) from public.record_revisions where record_id = 'usl/cm-10b' and status = 'published') = 1,
  'merge: the survivor''s current revision is the merge ("merged from ...")');
select pg_temp.check(
  (select status from public.record_revisions where id = (select id from cm_survivor_rev)) = 'superseded'
  and (select record_id || ' ' || status || ' ' || (document->>'id')
         from public.record_revisions where id = (select id from cm_loser_rev))
      = 'usl/cm-10b superseded usl/cm-10b',
  'merge: both earlier versions stay in the survivor''s history');
select pg_temp.check(
  exists (select 1 from public.record_revisions
           where record_id = 'usl/cm-10b' and status = 'suggested' and source_type = 'community'),
  'merge: an open suggestion on the duplicate moves to the survivor, still open');
select pg_temp.check(
  not exists (select 1 from public.record_revisions where record_id = 'uslinc/cm-10b'),
  'merge: nothing is left under the old id');
select pg_temp.check(
  (select record_ids from public.record_requests where details = 'idc merge') = array['usl/cm-10b'],
  'merge: record requests point at the survivor once');

-- ---- merge, survivor's document plus the power block --------------------------
select pg_temp.check(
  (select port_count from public.registry where id = 'qsc/ad-c6t-zb') = 2
  and (select document->'power' from public.registry where id = 'qsc/ad-c6t-zb') = '{"consumptionWatts":{"max":6}}'::jsonb
  and not exists (select 1 from public.registry where id = 'qsys/ad-c6t-zb'),
  'merge: qsc/ad-c6t-zb keeps its 2 ports and gains the power block from qsys/');

-- ---- merge with a normalized category ----------------------------------------
select pg_temp.check(
  (select category from public.registry where id = 'usl/dat-100') = 'av/test-equipment'
  and (select document->'device'->>'category' from public.registry where id = 'usl/dat-100') = 'av/test-equipment',
  'merge: usl/dat-100 gets the controlled category');

-- ---- not removals -------------------------------------------------------------
select pg_temp.check(
  (select count(*) from public.registry_removals) = (select n from removals_before)
  and not exists (select 1 from public.registry_removals
                   where id in ('qsys/nl-p4', 'uslinc/cm-10b', 'qsys/ad-c6t-zb', 'us-linc/dat-100')),
  'no rename or merge lands in the removals feed');

-- ---- idempotent ---------------------------------------------------------------
create temp table before_rerun as
  select (select count(*) from public.record_redirects) as redirects,
         (select count(*) from public.record_revisions where record_id = 'usl/cm-10b') as revs,
         (select count(*) from public.registry) as records;
\ir ../migrations/0013_record_id_cleanup.sql
select pg_temp.check(
  (select count(*) from public.record_redirects) = (select redirects from before_rerun)
  and (select count(*) from public.record_revisions where record_id = 'usl/cm-10b') = (select revs from before_rerun)
  and (select count(*) from public.registry) = (select records from before_rerun),
  'running the migration again changes nothing');

-- ---- the guard ----------------------------------------------------------------
do $$ begin
  insert into public.registry (id, kind, manufacturer, model, validation_status, document)
  values ('qsys/foo', 'device', 'QSC', 'Foo', 'draft', '{"id":"qsys/foo"}');
  raise exception 'FAIL: qsys/foo with manufacturer QSC was accepted';
exception when check_violation then
  if sqlerrm = 'id_prefix_mismatch: id prefix ''qsys'' doesn''t match brand slug ''qsc''' then
    raise notice 'ok: qsys/foo with manufacturer QSC is rejected (id_prefix_mismatch)';
  else raise; end if;
end $$;

insert into public.registry (id, kind, manufacturer, model, validation_status, document)
values ('qsc/foo', 'device', 'QSC', 'Foo', 'draft', '{"id":"qsc/foo"}');
select pg_temp.check(exists (select 1 from public.registry where id = 'qsc/foo'), 'qsc/foo with manufacturer QSC is accepted');

insert into public.registry (id, kind, manufacturer, model, validation_status, document)
values ('brand-new-labs/x', 'device', 'Brand New Labs', 'X', 'draft', '{"id":"brand-new-labs/x"}');
select pg_temp.check(
  (select slug from public.organizations where manufacturer = 'Brand New Labs') = 'brand-new-labs',
  'a new brand''s first record is accepted under its slug, and its profile is created');

do $$ begin
  insert into public.registry (id, kind, manufacturer, model, validation_status, document)
  values ('bnl/y', 'device', 'Brand New Labs', 'Y', 'draft', '{"id":"bnl/y"}');
  raise exception 'FAIL: bnl/y was accepted for Brand New Labs';
exception when check_violation then raise notice 'ok: a new brand''s record under another prefix is rejected';
end $$;

do $$ begin
  update public.registry set manufacturer = 'USL' where id = 'qsc/foo';
  raise exception 'FAIL: a manufacturer change without the id was accepted';
exception when check_violation then raise notice 'ok: changing the manufacturer alone is rejected';
end $$;

do $$ begin
  update public.registry set id = 'qsys/foo' where id = 'qsc/foo';
  raise exception 'FAIL: renaming onto an off-slug id was accepted';
exception when check_violation then raise notice 'ok: renaming onto an off-slug id is rejected';
end $$;

update public.registry set document = '{"id":"qsc/foo","note":"edited"}' where id = 'qsc/foo';
select pg_temp.check(true, 'an ordinary update of a correct record is untouched by the guard');

-- ---- brand slugs ----------------------------------------------------------------
select pg_temp.check(
  private.brand_slug('Société Générale') = 'societe-generale'
  and private.brand_slug('New Brand & Co') = 'new-brand-and-co'
  and private.brand_slug('İstanbul Ses') = 'istanbul-ses'
  and private.brand_slug(E'Café Audio') = 'cafe-audio'
  and private.brand_slug('Stem Audio') = 'stem-audio'
  and private.brand_slug('Ørsted') = 'rsted',
  'brand_slug strips accents like the SDK (NFD) and slugs the rest');

-- ---- merge errors -----------------------------------------------------------------
do $$ begin
  perform private.merge_record_ids('qsc/foo', 'qsc/does-not-exist');
  raise exception 'FAIL: a merge into a missing survivor went through';
exception when raise_exception then
  if sqlerrm like 'merge_record_ids: survivor % does not exist%' then
    raise notice 'ok: a merge into a missing survivor is refused';
  else raise; end if;
end $$;
