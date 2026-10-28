#!/usr/bin/env bash
# End-to-end test: real `auth` Edge Function (Deno) + real Postgres + the obfuscated schema.
# Needs: postgresql (server), deno (npx deno works), node 22+, python3.   Run from the repo root.
set -euo pipefail
DB=${DB:-sa_e2e}; PGPASS=${PGPASS:-testpw}
KEYDIR=$(mktemp -d); trap 'kill ${DPID:-0} 2>/dev/null || true; rm -rf "$KEYDIR"' EXIT
psql_admin() { su postgres -c "psql -q $*" 2>&1 | sed '/NOTICE/d'; }
psql_admin "-c \"ALTER ROLE postgres PASSWORD '$PGPASS'\""
psql_admin "-c 'DROP DATABASE IF EXISTS $DB' -c 'CREATE DATABASE $DB'"
su postgres -c "psql -q -d $DB" <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL
for f in $(ls supabase/migrations/*.sql | sort); do su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $PWD/$f" 2>&1 | sed '/NOTICE/d'; done
PUB=$(node scripts/sa-keys.ts vendor-keygen --out "$KEYDIR/v.key" | grep -o 'PUBLIC_KEY=.*' | cut -d= -f2)
PGURL="postgres://postgres:$PGPASS@127.0.0.1:5432/$DB" SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x \
  VENDOR_LICENSE_PUBLIC_KEY="$PUB" npx deno run --allow-net --allow-env --allow-read --no-lock \
  --import-map=security/tests/e2e/import_map.json supabase/functions/auth/index.ts >"$KEYDIR/fn.log" 2>&1 &
DPID=$!
for _ in $(seq 1 40); do curl -s -m 1 localhost:8000 >/dev/null 2>&1 && break; sleep 1; done
python3 security/tests/e2e/auth_flow.py "$KEYDIR/v.key" "$PUB" "$DB"
