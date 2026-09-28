// Global View / Sources derived payload (F5) — the browser pipeline moved
// into the backend worker. The exact same modules run here (normalize →
// filters/context → geo decision → markers); visitors download one bounded
// payload instead of fetching 97 sources and re-running the pipeline on
// their own CPU.

import type { Pool } from "pg";
import type { SourceDefinition as LegacySourceDefinition } from "@/data/sources/sourceTypes";
import { normalizeSourceItem } from "@/data/source-intelligence/normalizeSourceItem";
import { runSourceIntelligencePipeline } from "@/data/source-intelligence/sourceIntelligencePipeline";
import { sourceItemsToMarkers } from "@/data/source-intelligence/markers/sourceItemsToMarkers";
import type {
  IntelligenceEventCandidate,
  NormalizedSourceItem,
  SourceDefinition as IntelSourceDefinition,
} from "@/data/source-intelligence/sourceIntelligenceTypes";
import type { SourceMarkerFeature } from "@/data/source-intelligence/markers/sourceMarkerTypes";
import { loadEffectiveSourceCatalog } from "@/lib/backend/sources/effectiveCatalog";
import {
  hasFreshCurrentPayload,
  readDerivedPayload,
  storeDerivedPayload,
  type StoredDerivedPayload,
} from "@/lib/backend/payloads/payloadStore";
import { storeGlobeSnapshot } from "@/lib/backend/payloads/globeSnapshot";
import { persistProcessedEvents } from "@/lib/backend/repositories/processedEventsRepo";
import { log } from "@/lib/backend/observability/log";

export const GLOBAL_PAYLOAD_SCHEMA_VERSION = 1;
export const GLOBAL_PAYLOAD_STALE_AFTER_SECONDS = 30 * 60;
const REBUILD_MAX_AGE_SECONDS = 15 * 60;
// The feed used to be capped at the top 200 events (roadmap §16, a p95 latency
// target). That cap is gone by request — the payload now carries every accepted
// event. Payload size therefore tracks collection volume instead of being
// fixed, so §16's latency target is worth re-checking against the real numbers
// once this has run for a day.
/** Pipeline chunk size — keeps the worker loop responsive between chunks. */
const PIPELINE_CHUNK_SIZE = 250;

export type GlobalPayloadState = "fresh" | "partial";

export type GlobalSourceStatus = {
  sourceId: string;
  itemCount48h: number;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  consecutiveFailures: number;
};

export type GlobalFeedPayload = {
  schemaVersion: typeof GLOBAL_PAYLOAD_SCHEMA_VERSION;
  generatedAt: string;
  state: GlobalPayloadState;
  stateReasons: string[];
  coverage: {
    manifestSources: number;
    enabledSources: number;
    freshSources: number;
    sourcesWithItems: number;
  };
  /** Top accepted intelligence events (priority-sorted, ≤200). */
  events: IntelligenceEventCandidate[];
  /**
   * Globe/map markers. To avoid duplicating events (which already ship in
   * `events`), each marker references its events by id; the client rehydrates
   * `items` from the events array. Zero on-wire duplication, no truncation.
   */
  markers: GlobalMarker[];
  /** Items the filter gate rejected in this window (status-strip stat). */
  rejectedCount: number;
  totalWindowItems: number;
  sourceStatus: GlobalSourceStatus[];
};

/** A marker whose events are referenced by id, not embedded. */
export type GlobalMarker = Omit<SourceMarkerFeature, "items"> & {
  itemIds: string[];
};

// Heavy intermediate fields are stripped before persisting (§16 payload size).
// They fed the filter/geo passes that already ran here, or duplicate data the
// candidate already carries at top level:
//   - normalized* / locationResolutionCandidates / bodyText: pipeline scratch
//   - item: the full NormalizedSourceItem duplicates the candidate's own
//     title/summary/url/source fields (~40% of each event); the UI reads the
//     candidate's top-level fields, never candidate.item
//   - matches / matchedKeywords: filter-debug detail the screens don't render
// Marker/event duplication is handled separately by id-referencing (GlobalMarker),
// so no summary truncation or per-marker item cap is needed.
const STRIP_KEYS = new Set([
  "normalizedFilterText",
  "normalizedContextText",
  "normalizedTitleText",
  "normalizedSummaryFirstText",
  "normalizedBodyFirstText",
  "locationResolutionCandidates",
  "bodyText",
  "item",
  "matches",
  "matchedKeywords",
]);

function stripHeavyFields<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val) =>
      STRIP_KEYS.has(key) ? undefined : val,
    ),
  ) as T;
}

/** Rebuild the intel NormalizedSourceItem a browser adapter would produce. */
function intelItemFromRow(row: {
  source_id: string;
  upstream_item_id: string | null;
  fingerprint: string;
  title: string;
  summary: string | null;
  url: string | null;
  language: string | null;
  published_at: Date | null;
  collected_at: Date;
  verification: string;
  basis: string;
  metadata: Record<string, unknown> | null;
}, intelDef: IntelSourceDefinition | undefined,
legacyDef: LegacySourceDefinition | undefined): NormalizedSourceItem | null {
  if (!intelDef) return null;
  const metadata = row.metadata ?? {};

  return normalizeSourceItem(
    {
      id: `${row.source_id}::${row.upstream_item_id ?? row.fingerprint}`,
      sourceId: row.source_id,
      sourceName: intelDef.name,
      title: row.title,
      summary: row.summary ?? undefined,
      url: row.url ?? undefined,
      publishedAt: row.published_at?.toISOString(),
      collectedAt: row.collected_at.toISOString(),
      sourceLanguage: row.language ?? undefined,
      verificationStatus: row.verification,
      sourceBasis: row.basis,
      relatedCountries: metadata.relatedCountries,
      relatedRegions: metadata.relatedRegions,
      category: metadata.category,
      // Official/institutional anchor exactly as the RSS parser attaches it.
      sourceLocationForMarker: legacyDef?.sourceLocation
        ? {
            lat: legacyDef.sourceLocation.lat,
            lng: legacyDef.sourceLocation.lng,
            locationName: legacyDef.sourceLocation.label,
          }
        : undefined,
    },
    intelDef,
  );
}

/**
 * Full build result. `payload` is the served DTO; `acceptedEvents` and
 * `dbIdByEventId` let the worker persist processed_events (F6B) from the same
 * pipeline run without recomputing it.
 */
export type GlobalBuildResult = {
  payload: GlobalFeedPayload;
  acceptedEvents: IntelligenceEventCandidate[];
  dbIdByEventId: Map<string, number>;
};

function eventIdFor(row: {
  source_id: string;
  upstream_item_id: string | null;
  fingerprint: string;
}): string {
  return `${row.source_id}::${row.upstream_item_id ?? row.fingerprint}`;
}

/** Compose from the current 48h window. Heavy; call from the worker only. */
export async function composeGlobalArtifacts(
  pool: Pool,
): Promise<GlobalBuildResult> {
  const catalog = await loadEffectiveSourceCatalog(pool);
  const monitorSourceIds = catalog.sourceIdsForScreen("monitor");
  const { rows } = await pool.query(
    `SELECT id, source_id, upstream_item_id, fingerprint, title, summary, url,
            language, published_at, collected_at, verification, basis, metadata
       FROM collected_items
      WHERE source_id = ANY($1)
      ORDER BY published_at DESC NULLS LAST, collected_at DESC`,
    [monitorSourceIds],
  );

  const dbIdByEventId = new Map<string, number>();
  for (const row of rows) dbIdByEventId.set(eventIdFor(row), Number(row.id));

  const intelItems = rows
    .map((row) => intelItemFromRow(
      row,
      catalog.intelById.get(row.source_id),
      catalog.legacyById.get(row.source_id),
    ))
    .filter((item): item is NormalizedSourceItem => item !== null);

  // Chunked pipeline run: DB items are already deduped, so chunk results
  // concatenate without overlap. Yield between chunks to keep heartbeats.
  const allEvents: IntelligenceEventCandidate[] = [];
  let rejectedCount = 0;
  for (let i = 0; i < intelItems.length; i += PIPELINE_CHUNK_SIZE) {
    const chunk = intelItems.slice(i, i + PIPELINE_CHUNK_SIZE);
    const result = runSourceIntelligencePipeline(
      chunk,
      (sourceId) => catalog.intelById.get(sourceId),
    );
    allEvents.push(...result.eventCandidates);
    rejectedCount += result.filterResults.filter((r) => !r.accepted).length;
    await new Promise((resolve) => setImmediate(resolve));
  }

  allEvents.sort((a, b) => {
    const scoreDelta = b.priorityScore - a.priorityScore;
    if (scoreDelta !== 0) return scoreDelta;
    return (
      new Date(b.publishedAt ?? b.collectedAt ?? 0).getTime() -
      new Date(a.publishedAt ?? a.collectedAt ?? 0).getTime()
    );
  });
  // No cap: every accepted event ships. The list stays sorted by priority then
  // recency, so the most important events are still first — what changed is
  // that the tail is no longer discarded.
  const events = allEvents;
  // Markers reference their events by id instead of embedding copies (the same
  // events already ship in `events`). Marker items are always a subset of
  // `events`, so every id resolves on the client during rehydration.
  const markers: GlobalMarker[] = sourceItemsToMarkers(events).map(
    ({ items, ...marker }) => ({
      ...marker,
      itemIds: items.map((item) => item.id),
    }),
  );

  // Per-source health for the Sources screen.
  const stateRows = await pool.query(
    `SELECT s.source_id, s.last_success_at, s.last_error_code,
            s.consecutive_failures,
            s.last_success_at IS NOT NULL
              AND s.last_success_at > now() - make_interval(secs => 2 * s.effective_poll_interval_seconds)
              AS is_fresh,
            COALESCE(c.n, 0)::int AS item_count
       FROM source_runtime_state s
       LEFT JOIN (
         SELECT source_id, count(*) AS n FROM collected_items
          WHERE source_id = ANY($1) GROUP BY source_id
       ) c ON c.source_id = s.source_id
      WHERE s.enabled AND s.source_id = ANY($1)`,
    [monitorSourceIds],
  );

  const sourceStatus: GlobalSourceStatus[] = stateRows.rows.map((row) => ({
    sourceId: row.source_id,
    itemCount48h: row.item_count,
    lastSuccessAt: row.last_success_at?.toISOString(),
    lastErrorCode:
      row.consecutive_failures > 0 ? (row.last_error_code ?? undefined) : undefined,
    consecutiveFailures: row.consecutive_failures,
  }));

  const enabledCount = stateRows.rows.length;
  const freshCount = stateRows.rows.filter((r) => r.is_fresh).length;
  const sourcesWithItems = stateRows.rows.filter((r) => r.item_count > 0).length;

  const stateReasons: string[] = [];
  if (enabledCount < monitorSourceIds.length) {
    stateReasons.push(`enabled_${enabledCount}_of_${monitorSourceIds.length}`);
  }
  if (enabledCount > 0 && freshCount / enabledCount < 0.8) {
    stateReasons.push("fresh_sources_below_80pct");
  }

  const payload = stripHeavyFields<GlobalFeedPayload>({
    schemaVersion: GLOBAL_PAYLOAD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    state: stateReasons.length === 0 ? "fresh" : "partial",
    stateReasons,
    coverage: {
      manifestSources: monitorSourceIds.length,
      enabledSources: enabledCount,
      freshSources: freshCount,
      sourcesWithItems,
    },
    events,
    markers,
    rejectedCount,
    totalWindowItems: intelItems.length,
    sourceStatus,
  });

  return { payload, acceptedEvents: allEvents, dbIdByEventId };
}

/** Backward-compatible payload-only build (tests, callers that only serve). */
export async function composeGlobalPayload(
  pool: Pool,
): Promise<GlobalFeedPayload> {
  return (await composeGlobalArtifacts(pool)).payload;
}

export type StoredGlobalPayload = StoredDerivedPayload<GlobalFeedPayload>;

export async function readGlobalPayload(
  pool: Pool,
): Promise<StoredGlobalPayload | null> {
  return readDerivedPayload<GlobalFeedPayload>(pool, "global");
}

/** Worker hook: rebuild on new items or when the payload aged out. */
export async function maybeRebuildGlobalPayload(
  pool: Pool,
  hasNewItems: boolean,
  buildId = "dev",
): Promise<boolean> {
  if (
    !hasNewItems &&
    (await hasFreshCurrentPayload(pool, "global", REBUILD_MAX_AGE_SECONDS))
  ) {
    return false;
  }
  const started = performance.now();
  const { payload, acceptedEvents, dbIdByEventId } =
    await composeGlobalArtifacts(pool);
  await storeDerivedPayload(pool, "global", payload, buildId);
  // The globe snapshot (F6A) and processed_events (F6B) derive from this same
  // pipeline result — persist them here so the pipeline runs once per rebuild.
  // The globe uses ALL accepted events — as does the feed now that its cap is
  // gone; the two were only ever different while the feed was sliced — so it
  // stays populated with many locations.
  await storeGlobeSnapshot(pool, acceptedEvents, payload.state, buildId);
  const processed = await persistProcessedEvents(
    pool,
    acceptedEvents,
    dbIdByEventId,
  );
  log("info", "global_payload_built", {
    state: payload.state,
    events: payload.events.length,
    markers: payload.markers.length,
    windowItems: payload.totalWindowItems,
    rejected: payload.rejectedCount,
    processedEvents: processed,
    sources: payload.coverage.sourcesWithItems,
    durationMs: Math.round(performance.now() - started),
    reasons: payload.stateReasons.join(",") || null,
  });
  return true;
}
