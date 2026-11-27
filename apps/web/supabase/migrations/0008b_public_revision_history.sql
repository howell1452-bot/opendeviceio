-- Public revision history (provenance tiers brief, items 8–9).
--
-- The registry shows each record's history (date, source, status) and the API
-- serves GET /api/v1/devices/{id}/revisions plus a revision_count per record.
-- Only published and superseded revisions are public, and only while the
-- record itself is publicly visible: the EXISTS check runs under the caller's
-- RLS on registry, so a hidden brand's drafts or a removed record keep their
-- history private too. No submitter identity, change notes or review notes
-- are exposed (column grants).
--
-- Applies to anon (the website and the public API read as anon). Signed-in
-- clients keep the 0008a policy (their own and their brand's revisions).
-- Idempotent.

drop policy if exists "public revision history" on public.record_revisions;
create policy "public revision history"
  on public.record_revisions
  for select
  to anon
  using (
    status in ('published', 'superseded')
    and exists (select 1 from public.registry r where r.id = record_revisions.record_id)
  );

grant select (id, record_id, document, source_type, source_org_id, status, created_at)
  on table public.record_revisions to anon;

-- Revision counts for a page of records in one call (the list API). SECURITY
-- INVOKER: it counts only what the caller's RLS lets it see.
create or replace function public.record_revision_counts(p_ids text[])
returns table (record_id text, revision_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select x.record_id, count(*)::integer
    from public.record_revisions x
   where x.record_id = any (p_ids)
     and x.status in ('published', 'superseded')
   group by x.record_id;
$$;

revoke all on function public.record_revision_counts(text[]) from public;
grant execute on function public.record_revision_counts(text[]) to anon, authenticated, service_role;
