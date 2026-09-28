// collected_items + dedupe_tombstones repository (F2D).
// Implements the layered dedupe of roadmap §6.2/§7:
//   tier 1: (source_id, upstream_item_id)
//   tier 2: (source_id, canonical_url)
//   tier 3: (source_id, fingerprint)
//   tombstones: expired items stay deduped for 7 days, content-free.

import type { Pool } from "pg";
import type { CanonicalSourceItem } from "@/lib/backend/contracts/canonicalItem";

const ITEM_RETENTION_HOURS = 48;
const TOMBSTONE_RETENTION_DAYS = 7;

export type InsertBatchResult = {
  inserted: number;
  duplicates: number;
};

/**
 * Insert a batch of canonical items for one source. Existing rows (any dedupe
 * tier, or a live tombstone) count as duplicates and refresh last_seen_at
 * where applicable. Single-worker collector → a plain check-then-insert is
 * race-free; the unique indexes remain the hard backstop.
 */
export async function insertItems(
  pool: Pool,
  items: readonly CanonicalSourceItem[],
): Promise<InsertBatchResult> {
  let inserted = 0;
  let duplicates = 0;

  for (const item of items) {
    const dupe = await pool.query(
      `SELECT id FROM collected_items
        WHERE source_id = $1
          AND (fingerprint = $2
               OR (upstream_item_id IS NOT NULL AND upstream_item_id = $3)
               OR (canonical_url IS NOT NULL AND canonical_url = $4))
        LIMIT 1`,
      [
        item.sourceId,
        item.fingerprint,
        item.upstreamItemId ?? null,
        item.canonicalUrl ?? null,
      ],
    );
    if (dupe.rowCount) {
      await pool.query(
        `UPDATE collected_items
            SET last_seen_at = now(),
                summary = CASE
                  WHEN length(coalesce($2, '')) > length(coalesce(summary, '')) THEN $2
                  ELSE summary
                END
          WHERE id = $1`,
        [dupe.rows[0].id, item.summary ?? null],
      );
      duplicates += 1;
      continue;
    }

    const tombstoned = await pool.query(
      `SELECT 1 FROM dedupe_tombstones
        WHERE source_id = $1 AND fingerprint = $2 AND expires_at > now()
        LIMIT 1`,
      [item.sourceId, item.fingerprint],
    );
    if (tombstoned.rowCount) {
      duplicates += 1;
      continue;
    }

    const result = await pool.query(
      `INSERT INTO collected_items
         (source_id, upstream_item_id, url, canonical_url, fingerprint,
          title, summary, language, published_at, collected_at,
          verification, basis, extraction, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $10::timestamptz + make_interval(hours => ${ITEM_RETENTION_HOURS}))
       ON CONFLICT (source_id, fingerprint) DO NOTHING`,
      [
        item.sourceId,
        item.upstreamItemId ?? null,
        item.url ?? null,
        item.canonicalUrl ?? null,
        item.fingerprint,
        item.title,
        item.summary ?? null,
        item.language ?? null,
        item.publishedAt ?? null,
        item.collectedAt,
        item.verification,
        item.basis,
        item.extraction,
        item.metadata ? JSON.stringify(item.metadata) : null,
      ],
    );
    if (result.rowCount) inserted += 1;
    else duplicates += 1;
  }

  return { inserted, duplicates };
}

export type RetentionResult = {
  expiredItems: number;
  tombstonesWritten: number;
  tombstonesPurged: number;
};

/**
 * Rolling-window cleanup (§7): expired items become content-free tombstones,
 * tombstones older than 7 days disappear entirely.
 */
export async function purgeExpired(pool: Pool): Promise<RetentionResult> {
  const tombstones = await pool.query(
    `INSERT INTO dedupe_tombstones (source_id, fingerprint, upstream_item_id, expires_at)
     SELECT source_id, fingerprint, upstream_item_id,
            now() + make_interval(days => ${TOMBSTONE_RETENTION_DAYS})
       FROM collected_items
      WHERE expires_at <= now()
     ON CONFLICT (source_id, fingerprint) DO NOTHING`,
  );
  const expired = await pool.query(
    "DELETE FROM collected_items WHERE expires_at <= now()",
  );
  const purged = await pool.query(
    "DELETE FROM dedupe_tombstones WHERE expires_at <= now()",
  );
  return {
    expiredItems: expired.rowCount ?? 0,
    tombstonesWritten: tombstones.rowCount ?? 0,
    tombstonesPurged: purged.rowCount ?? 0,
  };
}

/**
 * Median gap between recent publish times for one source — feeds the
 * observed-cadence input of the scheduler (§8.1). Returns undefined until
 * enough data exists.
 */
export async function observedPublishIntervalSeconds(
  pool: Pool,
  sourceId: string,
): Promise<number | undefined> {
  const { rows } = await pool.query(
    `WITH gaps AS (
       SELECT EXTRACT(EPOCH FROM published_at - lag(published_at) OVER (ORDER BY published_at)) AS gap
         FROM collected_items
        WHERE source_id = $1 AND published_at IS NOT NULL
        ORDER BY published_at DESC
        LIMIT 50
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS median_gap
       FROM gaps WHERE gap IS NOT NULL AND gap > 0`,
    [sourceId],
  );
  const median = rows[0]?.median_gap;
  if (!median || median <= 0) return undefined;
  return Math.round(Number(median));
}
