// SQL migration runner (F1B) — roadmap §11.2 contract:
//   - schema changes only through numbered files in db/migrations/
//   - applied files are immutable (checksum-verified on every run)
//   - safe to run twice: already-applied versions are skipped
//   - concurrent runs are serialized with a PostgreSQL advisory lock
//
// Usage:
//   node scripts/db-migrate.mjs            → apply pending migrations
//   node scripts/db-migrate.mjs --status   → show applied/pending + connection
//
// Connection: ECHIS_DATABASE_URL_OWNER env var, falling back to the local
// compose defaults. Owner credentials are used because DDL is owner-only
// (§10.2); web/worker roles cannot migrate.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

// Single project-wide advisory key ("echis-migrate"); any stable constant works
// as long as every runner instance uses the same one.
const ADVISORY_LOCK_KEY = 0x45434849; // "ECHI"

export function checksumOf(sqlText) {
  return createHash("sha256").update(sqlText, "utf8").digest("hex");
}

/** Load migration files, sorted by version (filename prefix ordering). */
export function loadMigrationFiles(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name))
    .sort();
  return files.map((name) => {
    const sql = readFileSync(path.join(dir, name), "utf8");
    return { version: name, sql, checksum: checksumOf(sql) };
  });
}

/**
 * Compare on-disk migrations with applied rows.
 * Returns { pending, applied, errors } — errors are fatal contract breaches:
 * an applied file whose content changed, or an applied version missing on disk.
 */
export function planMigrations(files, appliedRows) {
  const appliedByVersion = new Map(appliedRows.map((r) => [r.version, r]));
  const fileVersions = new Set(files.map((f) => f.version));
  const errors = [];
  const pending = [];
  const applied = [];

  for (const row of appliedRows) {
    if (!fileVersions.has(row.version)) {
      errors.push(`applied migration missing on disk: ${row.version}`);
    }
  }
  for (const file of files) {
    const row = appliedByVersion.get(file.version);
    if (!row) {
      pending.push(file);
    } else if (row.checksum !== file.checksum) {
      errors.push(
        `applied migration was modified: ${file.version} ` +
          `(db=${row.checksum.slice(0, 12)}… disk=${file.checksum.slice(0, 12)}…)`,
      );
    } else {
      applied.push(file.version);
    }
  }
  return { pending, applied, errors };
}

function connectionString() {
  return (
    process.env.ECHIS_DATABASE_URL_OWNER ??
    "postgres://echis_owner:echis_local_owner_dev@127.0.0.1:5432/echis"
  );
}

async function withClient(fn) {
  const client = new pg.Client({
    connectionString: connectionString(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrate({ log = console.log } = {}) {
  const files = loadMigrationFiles();
  return withClient(async (client) => {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      await ensureMigrationsTable(client);
      const { rows } = await client.query(
        "SELECT version, checksum FROM schema_migrations ORDER BY version",
      );
      const plan = planMigrations(files, rows);
      if (plan.errors.length > 0) {
        throw new Error(`migration contract breach:\n  ${plan.errors.join("\n  ")}`);
      }
      if (plan.pending.length === 0) {
        log(`up to date (${plan.applied.length} applied)`);
        return { appliedNow: [], alreadyApplied: plan.applied };
      }
      const appliedNow = [];
      for (const file of plan.pending) {
        log(`applying ${file.version} …`);
        await client.query("BEGIN");
        try {
          await client.query(file.sql);
          await client.query(
            "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
            [file.version, file.checksum],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`migration failed in ${file.version}: ${err.message}`);
        }
        appliedNow.push(file.version);
      }
      log(`done: ${appliedNow.length} applied, ${plan.applied.length} skipped`);
      return { appliedNow, alreadyApplied: plan.applied };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  });
}

export async function status({ log = console.log } = {}) {
  const files = loadMigrationFiles();
  return withClient(async (client) => {
    const { rows: versionRows } = await client.query("SELECT version()");
    log(`connected: ${versionRows[0].version.split(",")[0]}`);
    await ensureMigrationsTable(client);
    const { rows } = await client.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    const plan = planMigrations(files, rows);
    for (const version of plan.applied) log(`applied  ${version}`);
    for (const file of plan.pending) log(`pending  ${file.version}`);
    for (const err of plan.errors) log(`ERROR    ${err}`);
    return plan;
  });
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const command = process.argv.includes("--status") ? status : migrate;
  command().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
