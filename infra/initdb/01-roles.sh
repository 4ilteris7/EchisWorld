#!/bin/sh
# Runs once on first database initialization (empty data volume).
# Creates the two least-privilege runtime roles per roadmap §10.2:
#   echis_worker → collector state + content read/write (granted in migrations)
#   echis_web    → read-only screen data (granted in migrations)
# echis_owner (POSTGRES_USER) stays migration/maintenance only.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'echis_worker') THEN
      CREATE ROLE echis_worker LOGIN PASSWORD '${ECHIS_WORKER_PASSWORD}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'echis_web') THEN
      CREATE ROLE echis_web LOGIN PASSWORD '${ECHIS_WEB_PASSWORD}';
    END IF;
  END
  \$\$;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO echis_worker, echis_web;
EOSQL
