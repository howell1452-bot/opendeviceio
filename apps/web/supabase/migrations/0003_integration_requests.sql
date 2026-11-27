-- Integration registrations: software vendors (design, catalog, CAD, PSA tools)
-- that consume registry data. The counterpart of access_requests, which is for
-- manufacturers who PUBLISH data.
--
-- A registration records who is using the data, how, and which version of the
-- data terms they accepted. It also gives admins a contact list for removal and
-- correction notices. It does not gate the public read API.
--
-- Users may create and read their own rows. Review (approve / decline) happens
-- through the service client on /admin, which bypasses RLS.
--
-- Idempotent: safe to run more than once.

create table if not exists public.integration_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  email           text,
  company         text not null check (length(btrim(company)) > 0),
  product         text,
  website         text,
  use_case        text not null
                    check (use_case in ('internal', 'signed-in-users', 'public', 'redistribution')),
  includes_drafts boolean not null default true,
  note            text,
  terms_version   text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists integration_requests_user_idx
  on public.integration_requests (user_id);
create index if not exists integration_requests_status_idx
  on public.integration_requests (status, created_at);

alter table public.integration_requests enable row level security;

drop policy if exists "insert own integration request" on public.integration_requests;
create policy "insert own integration request"
  on public.integration_requests
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

drop policy if exists "read own integration requests" on public.integration_requests;
create policy "read own integration requests"
  on public.integration_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select, insert on table public.integration_requests to authenticated;

-- Least privilege: drop project-default TRUNCATE / REFERENCES / TRIGGER grants
-- (TRUNCATE would bypass RLS); anon gets nothing here. Applied in production as
-- `tighten_new_table_grants`.
revoke truncate, references, trigger on table public.integration_requests from anon, authenticated;
revoke all on table public.integration_requests from anon;
