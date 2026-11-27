-- Brand claims and team invites (claim-your-brand brief, item 2).
--
-- access_requests becomes the claim queue: a claim names the brand's profile
-- row (org_id) and records the claimant's email domain and whether it matches
-- the brand's verified_domains, both derived on the server from the signed-in
-- user. Claims are filed by a server action with the service role only:
-- clients lose INSERT on access_requests (they keep reading their own rows).
--
-- brand_invites: a brand-admin invites a colleague by email. Service role
-- only, like 0007's member tables.
--
-- Rate limit: 5 claims per user per day, and one open claim per user per
-- brand. Idempotent.

-- ---------------------------------------------------------------------------
-- access_requests: claim details
-- ---------------------------------------------------------------------------
alter table public.access_requests
  add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.access_requests add column if not exists email_domain text;
alter table public.access_requests add column if not exists domain_match boolean;
alter table public.access_requests add column if not exists requester_role text;
alter table public.access_requests
  add column if not exists decided_by uuid references auth.users (id) on delete set null;
alter table public.access_requests add column if not exists decided_at timestamptz;
alter table public.access_requests add column if not exists decision_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'access_requests_text_lengths'
                 and conrelid = 'public.access_requests'::regclass) then
    alter table public.access_requests add constraint access_requests_text_lengths
      check (
        (note is null or length(note) <= 2000)
        and (requester_role is null or length(requester_role) <= 200)
        and (decision_note is null or length(decision_note) <= 2000)
        and (email_domain is null or length(email_domain) <= 253)
      );
  end if;
end;
$$;

create index if not exists access_requests_org_idx
  on public.access_requests (org_id, status);
create index if not exists access_requests_user_created_idx
  on public.access_requests (user_id, created_at);
create index if not exists access_requests_decided_by_idx
  on public.access_requests (decided_by)
  where decided_by is not null;

-- One open claim per user per brand.
create unique index if not exists access_requests_one_open_claim
  on public.access_requests (user_id, org_id)
  where status = 'pending' and org_id is not null;

-- ---------------------------------------------------------------------------
-- Claims go through the server: no client inserts
-- ---------------------------------------------------------------------------
revoke insert on table public.access_requests from anon, authenticated;
drop policy if exists "insert own request" on public.access_requests;

drop policy if exists "read own requests" on public.access_requests;
create policy "read own requests"
  on public.access_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Rate limit (SECURITY DEFINER, like 0005's record_requests limit).
create or replace function public.access_requests_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.access_requests
       where user_id = new.user_id
         and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited: you can file 5 brand claims per day; try again tomorrow'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.access_requests_rate_limit() from public, anon, authenticated;

drop trigger if exists access_requests_rate_limit on public.access_requests;
create trigger access_requests_rate_limit
  before insert on public.access_requests
  for each row execute function public.access_requests_rate_limit();

-- ---------------------------------------------------------------------------
-- brand_invites
-- ---------------------------------------------------------------------------
create table if not exists public.brand_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null check (length(email) between 3 and 320 and email like '%@%'),
  role         text not null default 'publisher' check (role in ('publisher', 'brand-admin')),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz
);

create unique index if not exists brand_invites_one_open
  on public.brand_invites (org_id, lower(email))
  where accepted_at is null and revoked_at is null;
create index if not exists brand_invites_email_idx
  on public.brand_invites (lower(email))
  where accepted_at is null and revoked_at is null;
create index if not exists brand_invites_invited_by_idx
  on public.brand_invites (invited_by)
  where invited_by is not null;

alter table public.brand_invites enable row level security;
-- No policies and no client grants: read and written by the service role.
revoke all on table public.brand_invites from anon, authenticated;
grant select, insert, update, delete on table public.brand_invites to service_role;
grant select, insert, update, delete on table public.access_requests to service_role;
