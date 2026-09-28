// collector_runs + collector_source_results repository (F2D, §6.4/§6.5).
// Aggregate bookkeeping only — no bodies, no secrets, no per-item logs.

import type { Pool } from "pg";

export type SourceResultRecord = {
  sourceId: string;
  httpStatus?: number;
  durationMs?: number;
  parsedItems: number;
  newItems: number;
  duplicateItems: number;
  notModified: boolean;
  errorCode?: string;
};

export async function startRun(pool: Pool, buildId: string): Promise<number> {
  const { rows } = await pool.query(
    "INSERT INTO collector_runs (build_id) VALUES ($1) RETURNING id",
    [buildId],
  );
  return rows[0].id as number;
}

export async function recordSourceResult(
  pool: Pool,
  runId: number,
  record: SourceResultRecord,
): Promise<void> {
  await pool.query(
    `INSERT INTO collector_source_results
       (run_id, source_id, http_status, duration_ms, parsed_items,
        new_items, duplicate_items, not_modified, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      runId,
      record.sourceId,
      record.httpStatus ?? null,
      record.durationMs ?? null,
      record.parsedItems,
      record.newItems,
      record.duplicateItems,
      record.notModified,
      record.errorCode ?? null,
    ],
  );
}

export type RunTotals = {
  attemptedSources: number;
  succeededSources: number;
  newItems: number;
  duplicateItems: number;
  rejectedItems: number;
  totalDurationMs: number;
};

export async function completeRun(
  pool: Pool,
  runId: number,
  totals: RunTotals,
): Promise<void> {
  const status =
    totals.attemptedSources === 0 || totals.succeededSources === totals.attemptedSources
      ? "success"
      : totals.succeededSources > 0
        ? "partial"
        : "failed";
  await pool.query(
    `UPDATE collector_runs SET
       completed_at = now(), status = $2,
       attempted_sources = $3, succeeded_sources = $4,
       new_items = $5, duplicate_items = $6, rejected_items = $7,
       total_duration_ms = $8
     WHERE id = $1`,
    [
      runId,
      status,
      totals.attemptedSources,
      totals.succeededSources,
      totals.newItems,
      totals.duplicateItems,
      totals.rejectedItems,
      totals.totalDurationMs,
    ],
  );
}
