-- Backfilled from production (applied 2026-05-30 as `api_token_self_manage`,
-- version 20260530070815) so the repo reproduces the live schema. Unchanged.

drop policy if exists "insert own tokens" on public.api_tokens;
create policy "insert own tokens" on public.api_tokens
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "delete own tokens" on public.api_tokens;
create policy "delete own tokens" on public.api_tokens
  for delete to authenticated using (auth.uid() = user_id);
