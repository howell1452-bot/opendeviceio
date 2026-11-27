-- Policy tuning for 0007 / 0008 (Supabase performance advisor). Same access,
-- cheaper evaluation:
--   * auth.uid() wrapped as (select auth.uid()) so it runs once per query
--     (an InitPlan) instead of once per row;
--   * record_revisions gets one SELECT policy for authenticated instead of two
--     permissive ones (own revisions OR the brand's revisions).
-- Idempotent.

drop policy if exists "read own organization memberships" on public.organization_members;
create policy "read own organization memberships"
  on public.organization_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "read own contributor status" on public.contributor_status;
create policy "read own contributor status"
  on public.contributor_status
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "submitters read own revisions" on public.record_revisions;
drop policy if exists "brand members read brand revisions" on public.record_revisions;
drop policy if exists "read own or brand revisions" on public.record_revisions;
create policy "read own or brand revisions"
  on public.record_revisions
  for select
  to authenticated
  using (
    submitted_by = (select auth.uid())
    or (manufacturer is not null and private.is_brand_member(manufacturer))
  );
