// PostgreSQL connection pools (F1B).
//
// Role separation per roadmap §10.2:
//   web    → ECHIS_DATABASE_URL_WEB    (read-only role, pool 5–10)
//   worker → ECHIS_DATABASE_URL_WORKER (state/content read-write, pool 3–5)
// Owner credentials are used only by the migration runner (scripts/db-migrate.mjs)
// and are never handed to application pools.
//
// Server-only module; never import from client components. Connection strings
// come from the environment and must never be logged.

import { Pool } from "pg";

export type BackendDbRole = "web" | "worker";

const LOCAL_DEFAULTS: Record<BackendDbRole, string> = {
  web: "postgres://echis_web:echis_local_web_dev@127.0.0.1:5432/echis",
  worker: "postgres://echis_worker:echis_local_worker_dev@127.0.0.1:5432/echis",
};

const POOL_SIZE: Record<BackendDbRole, number> = {
  web: 5,
  worker: 3,
};

function connectionStringFor(role: BackendDbRole): string {
  const envName =
    role === "web" ? "ECHIS_DATABASE_URL_WEB" : "ECHIS_DATABASE_URL_WORKER";
  return process.env[envName] ?? LOCAL_DEFAULTS[role];
}

const pools = new Map<BackendDbRole, Pool>();

/** Lazily create (once per process) and return the pool for a role. */
export function getPool(role: BackendDbRole): Pool {
  let pool = pools.get(role);
  if (!pool) {
    pool = new Pool({
      connectionString: connectionStringFor(role),
      max: POOL_SIZE[role],
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Bounded statement runtime keeps a bad query from pinning a connection.
      statement_timeout: 15_000,
    });
    pools.set(role, pool);
  }
  return pool;
}

export type DbHealth = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

/** Cheap bounded health probe for readiness checks (§9.5). */
export async function checkDbHealth(role: BackendDbRole): Promise<DbHealth> {
  const started = Date.now();
  try {
    await getPool(role).query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    // Message only — connection strings and stack traces stay out of responses.
    return {
      ok: false,
      error: err instanceof Error ? err.name : "db_unreachable",
    };
  }
}

/** Graceful shutdown helper for the worker process. */
export async function closePools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((pool) => pool.end()));
}
