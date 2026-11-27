-- Record id renames with redirects (launch fixes brief, item B).
--
-- record_redirects maps a retired record id to its current id. It is public
-- data (anyone can read it, through the API's /api/v1/redirects feed too);
-- only the service role writes it. Web pages, downloads and the API answer an
-- old id with a 308 to the new one.
--
-- A rename is not a removal: the registry_record_removal trigger now skips an
-- id change that has a matching redirect row, so renamed ids never appear in
-- /api/v1/removals.
--
-- This migration renames the 8 Attero Tech records that still carry the old
-- "attero-tech-by-qsc/" prefix (the brand is already "Attero Tech"). For each
-- pair, in one transaction: registry.id and the document's "id", every
-- revision of the record (record_id and its document's "id"), record_requests
-- that name it, and the redirect row. It aborts if a target id already exists.
-- Idempotent: pairs already renamed are skipped.
--
-- updated_at moves for the 8 rows, so mirrors syncing with updated_since pick
-- up the new ids and can drop the old ones using the redirects feed.

create table if not exists public.record_redirects (
  old_id      text primary key,
  new_id      text not null check (new_id <> old_id),
  created_at  timestamptz not null default now()
);

create index if not exists record_redirects_new_idx on public.record_redirects (new_id);
create index if not exists record_redirects_created_idx on public.record_redirects (created_at, old_id);

alter table public.record_redirects enable row level security;

drop policy if exists "record redirects are public" on public.record_redirects;
create policy "record redirects are public"
  on public.record_redirects
  for select
  to anon, authenticated
  using (true);

revoke all on table public.record_redirects from anon, authenticated;
grant select on table public.record_redirects to anon, authenticated;
grant select, insert, update, delete on table public.record_redirects to service_role;

-- ---------------------------------------------------------------------------
-- A rename with a redirect is not a removal (supersedes 0002's version).
-- ---------------------------------------------------------------------------
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
    if not exists (
      select 1 from public.record_redirects r
      where r.old_id = old.id and r.new_id = new.id
    ) then
      insert into public.registry_removals (id, kind, manufacturer)
      values (old.id, old.kind, old.manufacturer);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.registry_record_removal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rename one record id everywhere it is referenced. Service role / migrations
-- only. Returns false when there is nothing to do (already renamed).
-- ---------------------------------------------------------------------------
create or replace function private.rename_record_id(p_old text, p_new text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_old = p_new then
    raise exception 'rename_record_id: old and new id are the same (%)', p_old;
  end if;
  if not exists (select 1 from public.registry where id = p_old) then
    -- Already renamed (or never existed): just make sure the redirect is there
    -- when the new id is live.
    if exists (select 1 from public.registry where id = p_new) then
      insert into public.record_redirects (old_id, new_id) values (p_old, p_new)
      on conflict (old_id) do nothing;
    end if;
    return false;
  end if;
  if exists (select 1 from public.registry where id = p_new) then
    raise exception 'rename_record_id: target id % already exists; not renaming %', p_new, p_old;
  end if;

  -- The redirect first, so the removal trigger sees it.
  insert into public.record_redirects (old_id, new_id) values (p_old, p_new)
  on conflict (old_id) do update set new_id = excluded.new_id;

  update public.registry
     set id = p_new,
         document = case
           when jsonb_typeof(document) = 'object' then jsonb_set(document, '{id}', to_jsonb(p_new))
           else document
         end
   where id = p_old;

  update public.record_revisions
     set record_id = p_new,
         document = case
           when jsonb_typeof(document) = 'object' and document ? 'id'
             then jsonb_set(document, '{id}', to_jsonb(p_new))
           else document
         end
   where record_id = p_old;

  update public.record_requests
     set record_ids = array_replace(record_ids, p_old, p_new)
   where p_old = any (record_ids);

  -- Anything older that pointed at p_old now points at p_new (no chains).
  update public.record_redirects set new_id = p_new where new_id = p_old;

  return true;
end;
$$;

revoke all on function private.rename_record_id(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The 8 Attero Tech records
-- ---------------------------------------------------------------------------
do $$
declare
  pair text[];
  pairs text[][] := array[
    array['attero-tech-by-qsc/axiom-axpio',    'attero-tech/axiom-axpio'],
    array['attero-tech-by-qsc/axiom-ml1',      'attero-tech/axiom-ml1'],
    array['attero-tech-by-qsc/axon-dth1620',   'attero-tech/axon-dth1620'],
    array['attero-tech-by-qsc/synapse-d16mio', 'attero-tech/synapse-d16mio'],
    array['attero-tech-by-qsc/unbt2a',         'attero-tech/unbt2a'],
    array['attero-tech-by-qsc/und4o',          'attero-tech/und4o'],
    array['attero-tech-by-qsc/und6io',         'attero-tech/und6io'],
    array['attero-tech-by-qsc/undnemo',        'attero-tech/undnemo']
  ];
begin
  -- Check every target before touching anything.
  foreach pair slice 1 in array pairs loop
    if exists (select 1 from public.registry where id = pair[1])
       and exists (select 1 from public.registry where id = pair[2]) then
      raise exception 'record id rename aborted: % already exists (would collide with %)', pair[2], pair[1];
    end if;
  end loop;
  foreach pair slice 1 in array pairs loop
    perform private.rename_record_id(pair[1], pair[2]);
  end loop;
end;
$$;
