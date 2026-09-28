// processed_events repository (F6B). Persists the accepted pipeline events so
// the density API can aggregate news volume by region + domain over time
// windows, without re-running the pipeline per request.

import type { Pool } from "pg";
import type { IntelligenceEventCandidate } from "@/data/source-intelligence/sourceIntelligenceTypes";

export const ANALYSIS_VERSION = 1;
/** Aligns processed_events lifetime with the 48h collected_items window. */
const RETENTION_HOURS = 48;

function regionOf(event: IntelligenceEventCandidate): string | null {
  return event.resolvedLocation?.region ?? event.geoBasis?.region ?? null;
}

function coordsOf(
  event: IntelligenceEventCandidate,
): { lat: number; lng: number } | null {
  const loc = event.resolvedLocation;
  if (
    loc &&
    typeof loc.latitude === "number" &&
    typeof loc.longitude === "number"
  ) {
    return { lat: loc.latitude, lng: loc.longitude };
  }
  return null;
}

/**
 * Upsert the accepted events for the current build. Keyed by the collected_items
 * FK (item_id); events whose row id is unknown (shouldn't happen) are skipped.
 * Events not in this batch stay until their collected_items row is purged
 * (ON DELETE CASCADE), so the rolling 48h window self-cleans.
 */
export async function persistProcessedEvents(
  pool: Pool,
  events: readonly IntelligenceEventCandidate[],
  dbIdByEventId: Map<string, number>,
): Promise<number> {
  let written = 0;
  for (const event of events) {
    const itemId = dbIdByEventId.get(event.id);
    if (itemId === undefined) continue;
    const coords = coordsOf(event);
    await pool.query(
      `INSERT INTO processed_events
         (item_id, accepted, primary_domain, tags, event_type,
          relevance_score, priority_score, marker_eligibility,
          latitude, longitude, region, analysis_version, published_at, expires_at)
       VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               now() + make_interval(hours => ${RETENTION_HOURS}))
       ON CONFLICT (item_id) DO UPDATE SET
         primary_domain = EXCLUDED.primary_domain,
         tags = EXCLUDED.tags,
         event_type = EXCLUDED.event_type,
         relevance_score = EXCLUDED.relevance_score,
         priority_score = EXCLUDED.priority_score,
         marker_eligibility = EXCLUDED.marker_eligibility,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         region = EXCLUDED.region,
         analysis_version = EXCLUDED.analysis_version,
         published_at = EXCLUDED.published_at,
         processed_at = now(),
         expires_at = EXCLUDED.expires_at`,
      [
        itemId,
        event.primaryDomain,
        event.tags ?? [],
        event.eventType ?? null,
        event.relevanceScore ?? null,
        event.priorityScore ?? null,
        event.markerEligibility,
        coords?.lat ?? null,
        coords?.lng ?? null,
        regionOf(event),
        ANALYSIS_VERSION,
        event.publishedAt ?? null,
      ],
    );
    written += 1;
  }
  return written;
}

export type DensityBucket = {
  key: string;
  count: number;
  share: number;
};

export type DensityResult = {
  windowHours: number;
  from: string;
  to: string;
  totalItems: number;
  byRegion: DensityBucket[];
  byDomain: DensityBucket[];
};

/** Allowed windows per roadmap §6.6. */
export const DENSITY_WINDOWS = [6, 12, 24, 48] as const;
export type DensityWindow = (typeof DENSITY_WINDOWS)[number];

function toBuckets(
  rows: Array<{ key: string | null; n: number }>,
  total: number,
): DensityBucket[] {
  return rows
    .map((row) => ({
      key: row.key ?? "unspecified",
      count: row.n,
      share: total > 0 ? row.n / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * News-volume density for a window: how many accepted news events fall in the
 * last `windowHours`, grouped by region and by domain. This is an open-source
 * news-volume signal, not a verified event count.
 */
export async function densityForWindow(
  pool: Pool,
  windowHours: DensityWindow,
): Promise<DensityResult> {
  const bounds = await pool.query<{ from: Date; to: Date }>(
    `SELECT now() - make_interval(hours => $1) AS from, now() AS to`,
    [windowHours],
  );
  const { from, to } = bounds.rows[0];

  const totalRow = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM processed_events
      WHERE accepted AND published_at >= now() - make_interval(hours => $1)`,
    [windowHours],
  );
  const totalItems = totalRow.rows[0].n;

  const regionRows = await pool.query<{ key: string | null; n: number }>(
    `SELECT region AS key, count(*)::int AS n FROM processed_events
      WHERE accepted AND published_at >= now() - make_interval(hours => $1)
      GROUP BY region`,
    [windowHours],
  );
  const domainRows = await pool.query<{ key: string | null; n: number }>(
    `SELECT primary_domain AS key, count(*)::int AS n FROM processed_events
      WHERE accepted AND published_at >= now() - make_interval(hours => $1)
      GROUP BY primary_domain`,
    [windowHours],
  );

  return {
    windowHours,
    from: from.toISOString(),
    to: to.toISOString(),
    totalItems,
    byRegion: toBuckets(regionRows.rows, totalItems),
    byDomain: toBuckets(domainRows.rows, totalItems),
  };
}
