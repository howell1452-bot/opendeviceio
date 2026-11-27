-- Fix: the admin (service_role) key could not read or write the app tables.
--
-- In this project, tables created by migrations (owner `postgres`) get only
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN by default for anon, authenticated AND
-- service_role. service_role bypasses RLS, but still needs ordinary table
-- privileges, so every service-client call failed with "permission denied":
--   - /admin: listing/approving manufacturer access requests, integration
--     registrations, and record requests; removing records for a request
--   - POST /api/v1/devices with a Bearer token (api_tokens lookup,
--     manufacturer_members check)
--
-- Grants the admin role full DML on the app tables, and makes future tables
-- and sequences created by `postgres` in `public` usable by it the same way.
-- service_role is the server-only secret key; clients never hold it.
--
-- Idempotent.

grant select, insert, update, delete on table
  public.registry,
  public.registry_removals,
  public.access_requests,
  public.manufacturer_members,
  public.api_tokens,
  public.integration_requests,
  public.record_requests
to service_role;

grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
