-- Fix: signed-in users have no table privileges on the manufacturer tables.
--
-- 0001b/0001c created RLS policies for manufacturer_members, access_requests,
-- and api_tokens but never GRANTed the underlying table privileges, and this
-- project's default privileges don't grant SELECT/INSERT/DELETE to
-- `authenticated`. Every client call therefore fails with
-- "permission denied for table ...", which breaks:
--   - /contribute: submitting and listing access requests
--   - /contribute, /account, /publish, /author: listing your approved brands
--   - /account: minting, listing, and revoking API tokens
--   - /publish and cookie-session POST /api/v1/devices: the registry
--     insert/update policies sub-select manufacturer_members as the caller
--
-- The grants below match the existing RLS policies exactly (own rows only),
-- so they expose nothing those policies don't already allow. Memberships stay
-- read-only to users; admins grant them through the service role.
--
-- Also drops the project-default TRUNCATE / REFERENCES / TRIGGER grants on the
-- older public tables (TRUNCATE bypasses RLS).
--
-- Idempotent.

grant select, insert         on table public.access_requests      to authenticated;
grant select                 on table public.manufacturer_members to authenticated;
grant select, insert, delete on table public.api_tokens           to authenticated;

revoke truncate, references, trigger on table public.registry             from anon, authenticated;
revoke truncate, references, trigger on table public.access_requests      from anon, authenticated;
revoke truncate, references, trigger on table public.manufacturer_members from anon, authenticated;
revoke truncate, references, trigger on table public.api_tokens           from anon, authenticated;
