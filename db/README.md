# EchisWorld database

The database schema is managed exclusively through numbered SQL migrations in `db/migrations/`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run backend:up` | Start the local PostgreSQL service and wait for health checks |
| `npm run backend:down` | Stop the service without deleting its data volume |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:status` | Show the connection and applied/pending migrations |
| `npm run db:backup` | Create a custom-format dump and SHA-256 sidecar in `backups/` |
| `npm run db:restore -- --in <dump> --target <url>` | Verify and restore a dump into a separate database |

The backup and restore scripts require `pg_dump` and `pg_restore` versions compatible with the server. The primary database is protected from restore unless the operator explicitly supplies the force option.

## Migration rules

1. Change the schema only through a new `db/migrations/NNNN_name.sql` file.
2. Never edit a migration that has already been applied. The runner verifies checksums; corrections belong in a new migration.
3. The runner uses an advisory lock to prevent concurrent migration runs.
4. Each migration runs in its own transaction and rolls back on failure.
5. Application startup code must not perform schema changes.

## Database roles

| Role | Access | Used by |
| --- | --- | --- |
| `echis_owner` | DDL, migration, and maintenance | Migration and maintenance commands only |
| `echis_worker` | Application-table read/write | Collector worker |
| `echis_web` | Read-only application data; scoped write access to `personal_sources` | Next.js web application |

These compatibility role names intentionally retain the original `echis_` prefix. Renaming them would require a database migration and coordinated deployment. Passwords come from environment variables and must never be committed.

## Safety

- Use `ECHIS_DATABASE_URL_OWNER`, `ECHIS_DATABASE_URL_WORKER`, and `ECHIS_DATABASE_URL_WEB` in deployed environments.
- Point integration tests only at a disposable database through `ECHIS_TEST_DATABASE_URL`; those tests reset their target.
- Test backups by restoring them into a separate database. A successful dump command alone does not prove recoverability.
- Prefer the `local:*` commands documented in the root README for ordinary local development.
