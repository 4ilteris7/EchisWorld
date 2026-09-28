// source_runtime_state repository (F2D) — the only place that reads/writes
// scheduler state SQL. Static identity stays in the manifest; this table holds
// only what changes at runtime (§5.4).

import type { Pool } from "pg";
import type { CanonicalSourceManifestEntry } from "@/lib/backend/sources/manifest";
import type {
  ScheduleDecision,
  ScheduleState,
} from "@/lib/backend/collector/schedule";

export type DueSource = {
  sourceId: string;
  etag?: string;
  lastModified?: string;
  state: ScheduleState;
};

/**
 * Ensure runtime rows exist for the given manifest entries (bootstrap).
 * Existing rows are left untouched so restarts never lose learned state.
 */
export async function ensureSourceStateRows(
  pool: Pool,
  entries: readonly CanonicalSourceManifestEntry[],
): Promise<number> {
  let created = 0;
  for (const entry of entries) {
    const result = await pool.query(
      `INSERT INTO source_runtime_state
         (source_id, schedule_mode,
          min_poll_interval_seconds, base_poll_interval_seconds,
          max_poll_interval_seconds, effective_poll_interval_seconds,
          schedule_reason, daily_request_budget, next_poll_at)
       VALUES ($1, $2, $3, $4, $5, $4, 'bootstrap', $6, now())
       ON CONFLICT (source_id) DO NOTHING`,
      [
        entry.sourceId,
        entry.schedule.scheduleMode,
        entry.schedule.minPollIntervalSeconds,
        entry.schedule.basePollIntervalSeconds,
        entry.schedule.maxPollIntervalSeconds,
        entry.schedule.dailyRequestBudget?.requestsPerDay ?? null,
      ],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

/** Sources whose next_poll_at has arrived (and any backoff has elapsed). */
export async function findDueSources(
  pool: Pool,
  limit: number,
): Promise<DueSource[]> {
  const { rows } = await pool.query(
    `SELECT source_id, etag, last_modified,
            effective_poll_interval_seconds, unchanged_streak,
            consecutive_failures, observed_publish_interval_seconds,
            rss_ttl_hint_seconds, cache_control_max_age_seconds
       FROM source_runtime_state
      WHERE enabled
        AND next_poll_at <= now()
        AND (backoff_until IS NULL OR backoff_until <= now())
      ORDER BY next_poll_at
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    sourceId: row.source_id,
    etag: row.etag ?? undefined,
    lastModified: row.last_modified ?? undefined,
    state: {
      effectivePollIntervalSeconds: row.effective_poll_interval_seconds,
      unchangedStreak: row.unchanged_streak,
      consecutiveFailures: row.consecutive_failures,
      observedPublishIntervalSeconds:
        row.observed_publish_interval_seconds ?? undefined,
      rssTtlHintSeconds: row.rss_ttl_hint_seconds ?? undefined,
      cacheControlMaxAgeSeconds:
        row.cache_control_max_age_seconds ?? undefined,
    },
  }));
}

export type SourceAttemptUpdate = {
  sourceId: string;
  decision: ScheduleDecision;
  success: boolean;
  contentChanged: boolean;
  httpStatus?: number;
  errorCode?: string;
  durationMs?: number;
  newItemCount?: number;
  etag?: string;
  lastModified?: string;
  rssTtlHintSeconds?: number;
  cacheControlMaxAgeSeconds?: number;
  observedPublishIntervalSeconds?: number;
};

/** Persist one attempt's outcome + the scheduler decision atomically. */
export async function recordSourceAttempt(
  pool: Pool,
  update: SourceAttemptUpdate,
): Promise<void> {
  const d = update.decision;
  await pool.query(
    `UPDATE source_runtime_state SET
       last_attempt_at = now(),
       last_success_at = CASE WHEN $2 THEN now() ELSE last_success_at END,
       last_content_change_at = CASE WHEN $3 THEN now() ELSE last_content_change_at END,
       effective_poll_interval_seconds = $4,
       schedule_reason = $5,
       unchanged_streak = $6,
       consecutive_failures = $7,
       next_poll_at = now() + make_interval(secs => $8),
       backoff_until = CASE WHEN $5 = 'backoff'
                            THEN now() + make_interval(secs => $8)
                            ELSE NULL END,
       last_http_status = $9,
       last_error_code = $10,
       last_duration_ms = $11,
       last_new_item_count = $12,
       etag = COALESCE($13, etag),
       last_modified = COALESCE($14, last_modified),
       rss_ttl_hint_seconds = COALESCE($15, rss_ttl_hint_seconds),
       cache_control_max_age_seconds = COALESCE($16, cache_control_max_age_seconds),
       observed_publish_interval_seconds = COALESCE($17, observed_publish_interval_seconds),
       updated_at = now()
     WHERE source_id = $1`,
    [
      update.sourceId,
      update.success,
      update.contentChanged,
      d.effectivePollIntervalSeconds,
      d.scheduleReason,
      d.unchangedStreak,
      d.consecutiveFailures,
      d.nextPollDelaySeconds,
      update.httpStatus ?? null,
      update.errorCode ?? null,
      update.durationMs ?? null,
      update.newItemCount ?? null,
      update.etag ?? null,
      update.lastModified ?? null,
      update.rssTtlHintSeconds ?? null,
      update.cacheControlMaxAgeSeconds ?? null,
      update.observedPublishIntervalSeconds ?? null,
    ],
  );
}
