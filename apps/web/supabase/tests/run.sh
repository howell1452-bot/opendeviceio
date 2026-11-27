#!/usr/bin/env bash
# Apply every migration to an empty Postgres (with the Supabase stub), apply
# the newer ones a second time to prove they're idempotent, then run the RLS
# and constraint tests. Uses the standard PG* environment variables.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=odio_test bash run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../migrations"
psql_q() { psql -v ON_ERROR_STOP=1 -q -X "$@"; }

echo "== stub"
psql_q -f "$here/00_supabase_stub.sql"

echo "== migrations"
for f in $(ls "$migrations"/*.sql | sort); do
  echo "   $(basename "$f")"
  psql_q -f "$f" > /dev/null
done

echo "== idempotency (second run)"
for f in $(ls "$migrations"/*.sql | sort); do
  case "$(basename "$f")" in
    0007_*|0008*|0010_*|0011_*)
      echo "   $(basename "$f")"
      psql_q -f "$f" > /dev/null ;;
  esac
done

echo "== tests"
for t in $(ls "$here"/*.test.sql | sort); do
  echo "   $(basename "$t")"
  psql_q -f "$t"
done
echo "== all database tests passed"
