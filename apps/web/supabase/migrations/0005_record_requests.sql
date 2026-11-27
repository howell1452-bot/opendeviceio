-- Public "correct or remove a record" requests (no sign-up).
--
-- Anyone (anon or signed in) may INSERT a request; nobody but the service role
-- (/admin) may read or change one. Anonymous callers can only write the
-- request columns (column-level grant), never status or admin fields.
--
-- Spam control lives in the database so it also holds for callers that skip
-- the website and hit the Data API directly with the public key:
--   * per email:   at most 5 requests per hour
--   * per IP hash: at most 10 per hour (set by the site's server action)
--   * global:      at most 60 per 10 minutes
-- The site adds a honeypot field and a minimum fill time on top.
--
-- Idempotent.

create table if not exists public.record_requests (
  id            uuid primary key default gen_random_uuid(),
  request_type  text not null
                  check (request_type in ('correction', 'removal', 'verify')),
  record_ids    text[] not null default '{}'
                  check (cardinality(record_ids) <= 200),
  name          text not null check (length(btrim(name)) between 1 and 200),
  company       text not null check (length(btrim(company)) between 1 and 200),
  email         text not null
                  check (length(email) <= 320 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  details       text check (details is null or length(details) <= 5000),
  ip_hash       text check (ip_hash is null or length(ip_hash) <= 128),
  user_agent    text check (user_agent is null or length(user_agent) <= 500),
  status        text not null default 'new'
                  check (status in ('new', 'in-progress', 'resolved', 'declined')),
  admin_note    text,
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists record_requests_status_idx
  on public.record_requests (status, created_at);
create index if not exists record_requests_email_idx
  on public.record_requests (lower(email), created_at);
create index if not exists record_requests_ip_idx
  on public.record_requests (ip_hash, created_at);

-- Rate limits. SECURITY DEFINER so it can count rows the caller cannot read.
create or replace function public.record_requests_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.record_requests
        where lower(email) = lower(new.email)
          and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited: too many requests from this email address; try again later'
      using errcode = 'P0001';
  end if;
  if new.ip_hash is not null and (select count(*) from public.record_requests
        where ip_hash = new.ip_hash
          and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited: too many requests from this network; try again later'
      using errcode = 'P0001';
  end if;
  if (select count(*) from public.record_requests
        where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'rate_limited: the request queue is busy; try again in a few minutes'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.record_requests_rate_limit() from public, anon, authenticated;

drop trigger if exists record_requests_rate_limit on public.record_requests;
create trigger record_requests_rate_limit
  before insert on public.record_requests
  for each row execute function public.record_requests_rate_limit();

alter table public.record_requests enable row level security;

drop policy if exists "anyone can file a record request" on public.record_requests;
create policy "anyone can file a record request"
  on public.record_requests
  for insert
  to anon, authenticated
  with check (
    status = 'new'
    and admin_note is null
    and resolved_by is null
    and resolved_at is null
  );

-- Insert only, and only the request columns. No SELECT/UPDATE/DELETE for
-- clients: requests are read and handled on /admin via the service role.
revoke all on table public.record_requests from anon, authenticated;
grant insert (request_type, record_ids, name, company, email, details, ip_hash, user_agent)
  on table public.record_requests to anon, authenticated;
