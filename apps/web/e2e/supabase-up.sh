#!/usr/bin/env bash
# Start a local Supabase stack (Postgres, Auth, PostgREST, mail catcher) with
# this repo's migrations, for the Playwright end-to-end tests. Needs the
# Supabase CLI and Docker. Writes the stack's URL and keys to e2e/.env.e2e,
# and to $GITHUB_ENV when running in GitHub Actions.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${E2E_WORKDIR:-${RUNNER_TEMP:-/tmp}/odio-e2e}"
rm -rf "$work"
mkdir -p "$work"
cd "$work"

sb() { supabase --workdir "$work" "$@"; }

cfg="$work/supabase/config.toml"
sb init </dev/null || true
if [ -f "$cfg" ]; then
  # Auth: magic links come back to the Next app; many sign-ins in one run.
  patch() { # key, value
    if ! grep -qE "^$1 = " "$cfg"; then echo "config.toml has no '$1'" >&2; exit 1; fi
    sed -i -E "s|^$1 = .*|$1 = $2|" "$cfg"
  }
  patch site_url '"http://localhost:3000"'
  patch additional_redirect_urls '["http://localhost:3000/**"]'
  patch email_sent 1000
else
  echo "supabase init produced no config.toml; using e2e/supabase/config.toml"
  mkdir -p "$work/supabase"
  cp "$here/supabase/config.toml" "$cfg"
fi
grep -E '^(site_url|additional_redirect_urls|email_sent) = ' "$cfg"

# The CLI only accepts <digits>_<name>.sql; keep the repo's order (0001,
# 0001b, 0001c, ...) with sequential versions.
mkdir -p "$work/supabase/migrations"
i=0
for f in $(ls "$here/../supabase/migrations"/*.sql | sort); do
  i=$((i + 1))
  name="$(basename "$f" .sql | sed -E 's/^[0-9]+[a-z]?_//')"
  cp "$f" "$work/supabase/migrations/$(printf '20260101%06d' "$i")_${name}.sql"
done
ls "$work/supabase/migrations"

sb start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,postgres-meta
sb status -o env > "$work/status.env"
# shellcheck disable=SC1091
source "$work/status.env"

mail_url="${INBUCKET_URL:-${MAILPIT_URL:-http://127.0.0.1:54324}}"
{
  echo "NEXT_PUBLIC_SUPABASE_URL=${API_URL}"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
  echo "SUPABASE_SECRET_KEY=${SERVICE_ROLE_KEY}"
  echo "E2E_DB_URL=${DB_URL}"
  echo "E2E_MAIL_URL=${mail_url}"
} > "$here/.env.e2e"
if [ -n "${GITHUB_ENV:-}" ]; then cat "$here/.env.e2e" >> "$GITHUB_ENV"; fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$here/seed.sql"
echo "Local Supabase is up: $API_URL (mail: $mail_url)"
