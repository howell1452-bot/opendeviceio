-- Every registry row has a current revision (follow-up to 0008).
--
-- The 0008 backfill covered rows that existed then. Rows inserted later
-- outside the revision flow (tools/seed-registry.mjs, a direct service-role
-- insert) would have no history and no revision_id. This trigger gives such a
-- row its first 'published' revision, with the row's own source. Server-side
-- publishes (lib/revisions.ts) insert the revision first and set
-- current_revision_id themselves, so they are skipped.
--
-- The pointer update only changes current_revision_id, so the 0008 updated_at
-- trigger leaves updated_at alone. Idempotent.

create or replace function public.registry_first_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.current_revision_id is null and new.document is not null then
    insert into public.record_revisions
      (record_id, document, manufacturer, source_type, source_org_id, status, is_new_record)
    values
      (new.id, new.document, new.manufacturer, new.source_type, new.source_org_id, 'published', true)
    returning id into v_id;
    update public.registry set current_revision_id = v_id where id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.registry_first_revision() from public, anon, authenticated;

drop trigger if exists registry_first_revision on public.registry;
create trigger registry_first_revision
  after insert on public.registry
  for each row execute function public.registry_first_revision();

-- Rows inserted between 0008 and this migration.
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
