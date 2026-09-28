// Cyber News derived payload (F3A) — built once in the worker, served to every
// visitor from PostgreSQL. Replaces the browser-side "18 fetches + client
// analysis" path (roadmap Faz 3).
//
// current/previous slots swap atomically (§6.6): a broken new build can never
// destroy the last good payload, and readers fall back to `previous` marked
// stale when `current` is missing.

import type { Pool } from "pg";
import { analyzeCyberSignals, type CyberSignalResult } from "@/lib/cyber";
import {
  CANONICAL_SOURCE_MANIFEST,
} from "@/lib/backend/sources/manifest";
import { loadEffectiveSourceCatalog } from "@/lib/backend/sources/effectiveCatalog";
import {
  hasFreshCurrentPayload,
  readDerivedPayload,
  storeDerivedPayload,
  type StoredDerivedPayload,
} from "@/lib/backend/payloads/payloadStore";
import { log } from "@/lib/backend/observability/log";

export const CYBER_PAYLOAD_SCHEMA_VERSION = 1;
// The screen used to take only the newest 200 items (roadmap §16). That cap is
// gone by request; the query now returns everything the rolling window holds.
// It stays bounded because `collected_items` keeps 48 hours
// (ITEM_RETENTION_HOURS in itemsRepo.ts) — this reads a window, not history.
/** A payload older than this reads as stale (2× the expected rebuild pace). */
export const CYBER_PAYLOAD_STALE_AFTER_SECONDS = 30 * 60;
/** Rebuild at least this often even without new items (state freshness). */
const REBUILD_MAX_AGE_SECONDS = 15 * 60;

export type CyberFeedPayloadItem = {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt?: string;
  collectedAt: string;
  category?: string;
};

export type CyberPayloadState = "fresh" | "partial";

export type CyberFeedPayload = {
  schemaVersion: typeof CYBER_PAYLOAD_SCHEMA_VERSION;
  generatedAt: string;
  state: CyberPayloadState;
  stateReasons: string[];
  coverage: {
    manifestSources: number;
    enabledSources: number;
    freshSources: number;
    sourcesWithItems: number;
  };
  items: CyberFeedPayloadItem[];
  analysis: CyberSignalResult;
};

const CRITICAL_CYBER_IDS = CANONICAL_SOURCE_MANIFEST.filter(
  (entry) => entry.critical && entry.targetScreens.includes("cyber_news"),
).map((entry) => entry.sourceId);
/** Compose the payload from the current 48h window. Pure read; no swap. */
export async function composeCyberPayload(
  pool: Pool,
): Promise<CyberFeedPayload> {
  const catalog = await loadEffectiveSourceCatalog(pool);
  const cyberSourceIds = catalog.sourceIdsForScreen("cyber_news");
  const { rows } = await pool.query(
    `SELECT source_id, upstream_item_id, fingerprint, title, summary, url,
            published_at, collected_at, metadata->>'category' AS category
       FROM collected_items
      WHERE source_id = ANY($1)
      ORDER BY published_at DESC NULLS LAST, collected_at DESC`,
    [cyberSourceIds],
  );

  const items: CyberFeedPayloadItem[] = rows.map((row) => ({
    id: `${row.source_id}::${row.upstream_item_id ?? row.fingerprint}`,
    sourceId: row.source_id,
    sourceName: catalog.sourceNameById.get(row.source_id) ?? row.source_id,
    title: row.title,
    summary: row.summary ?? undefined,
    url: row.url ?? undefined,
    publishedAt: row.published_at?.toISOString(),
    collectedAt: row.collected_at.toISOString(),
    category: row.category ?? undefined,
  }));

  const analysis = analyzeCyberSignals(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
    })),
    { includeAnnotations: true },
  );

  const stateRows = await pool.query(
    `SELECT source_id,
            last_success_at IS NOT NULL
              AND last_success_at > now() - make_interval(secs => 2 * effective_poll_interval_seconds)
              AS is_fresh
       FROM source_runtime_state
      WHERE enabled AND source_id = ANY($1)`,
    [cyberSourceIds],
  );
  const enabledIds = new Set<string>(stateRows.rows.map((r) => r.source_id));
  const freshIds = new Set<string>(
    stateRows.rows.filter((r) => r.is_fresh).map((r) => r.source_id),
  );
  const sourcesWithItems = new Set(items.map((item) => item.sourceId)).size;

  const stateReasons: string[] = [];
  if (enabledIds.size < cyberSourceIds.length) {
    stateReasons.push(
      `enabled_${enabledIds.size}_of_${cyberSourceIds.length}`,
    );
  }
  for (const critical of CRITICAL_CYBER_IDS) {
    if (enabledIds.has(critical) && !freshIds.has(critical)) {
      stateReasons.push(`critical_overdue_${critical}`);
    }
  }
  const enabledFreshRatio =
    enabledIds.size === 0 ? 0 : freshIds.size / enabledIds.size;
  if (enabledIds.size > 0 && enabledFreshRatio < 0.8) {
    stateReasons.push("fresh_sources_below_80pct");
  }

  return {
    schemaVersion: CYBER_PAYLOAD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    state: stateReasons.length === 0 ? "fresh" : "partial",
    stateReasons,
    coverage: {
      manifestSources: cyberSourceIds.length,
      enabledSources: enabledIds.size,
      freshSources: freshIds.size,
      sourcesWithItems,
    },
    items,
    analysis,
  };
}

/** Atomic current/previous swap (§6.6) via the shared payload store. */
export async function storeCyberPayload(
  pool: Pool,
  payload: CyberFeedPayload,
  buildId = "dev",
): Promise<void> {
  await storeDerivedPayload(pool, "cyber", payload, buildId);
}

export type StoredCyberPayload = StoredDerivedPayload<CyberFeedPayload>;

/** Read for the API: current first, previous as stale fallback. */
export async function readCyberPayload(
  pool: Pool,
): Promise<StoredCyberPayload | null> {
  return readDerivedPayload<CyberFeedPayload>(pool, "cyber");
}

/**
 * Worker hook: rebuild when new items arrived or the payload aged out.
 * Returns true when a rebuild happened.
 */
export async function maybeRebuildCyberPayload(
  pool: Pool,
  hasNewItems: boolean,
  buildId = "dev",
): Promise<boolean> {
  if (
    !hasNewItems &&
    (await hasFreshCurrentPayload(pool, "cyber", REBUILD_MAX_AGE_SECONDS))
  ) {
    return false;
  }
  const payload = await composeCyberPayload(pool);
  await storeCyberPayload(pool, payload, buildId);
  log("info", "cyber_payload_built", {
    state: payload.state,
    items: payload.items.length,
    sourcesWithItems: payload.coverage.sourcesWithItems,
    reasons: payload.stateReasons.join(",") || null,
  });
  return true;
}
