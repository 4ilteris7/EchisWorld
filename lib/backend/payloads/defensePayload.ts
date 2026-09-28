// Defense Industry derived payload (F4A) — worker-built, mirrors the Cyber
// payload contract. The screen's detection engine (lib/defense) runs here
// once; visitors receive the finished analysis.

import type { Pool } from "pg";
import {
  analyzeDefenseSignals,
  type DefenseSignalInput,
} from "@/lib/defense";
import type { DefenseAnalysisResult } from "@/lib/defense/types";
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

export const DEFENSE_PAYLOAD_SCHEMA_VERSION = 1;
export const DEFENSE_PAYLOAD_STALE_AFTER_SECONDS = 30 * 60;
const REBUILD_MAX_AGE_SECONDS = 15 * 60;
// Cap removed by request (was roadmap §16's top-200). Still bounded: the query
// reads the 48-hour rolling window `collected_items` keeps, not all history.

export type DefensePayloadState = "fresh" | "partial";

export type DefenseFeedPayload = {
  schemaVersion: typeof DEFENSE_PAYLOAD_SCHEMA_VERSION;
  generatedAt: string;
  state: DefensePayloadState;
  stateReasons: string[];
  coverage: {
    manifestSources: number;
    enabledSources: number;
    freshSources: number;
    sourcesWithItems: number;
  };
  /** Finished screen analysis: gated feed items, segments, supply chain. */
  analysis: DefenseAnalysisResult;
};

const CRITICAL_DEFENSE_IDS = CANONICAL_SOURCE_MANIFEST.filter(
  (entry) => entry.critical && entry.targetScreens.includes("defense_industry"),
).map((entry) => entry.sourceId);
/** Compose from the current 48h window. Pure read; no swap. */
export async function composeDefensePayload(
  pool: Pool,
): Promise<DefenseFeedPayload> {
  const catalog = await loadEffectiveSourceCatalog(pool);
  const defenseSourceIds = catalog.sourceIdsForScreen("defense_industry");
  const { rows } = await pool.query(
    `SELECT source_id, upstream_item_id, fingerprint, title, summary, url,
            published_at, collected_at, verification
       FROM collected_items
      WHERE source_id = ANY($1)
      ORDER BY published_at DESC NULLS LAST, collected_at DESC`,
    [defenseSourceIds],
  );

  const inputs: DefenseSignalInput[] = rows.map((row) => {
    const sourceName = catalog.sourceNameById.get(row.source_id) ?? row.source_id;
    return {
      id: `${row.source_id}::${row.upstream_item_id ?? row.fingerprint}`,
      title: row.title,
      summary: row.summary ?? undefined,
      source: sourceName,
      url: row.url ?? undefined,
      publishedAt: row.published_at?.toISOString(),
      collectedAt: row.collected_at.toISOString(),
      // Canonical vocabulary → engine hint ("official" lifts confidence).
      verificationStatus: row.verification,
      sourceType: sourceName,
    };
  });

  const analysis = analyzeDefenseSignals(inputs);

  const stateRows = await pool.query(
    `SELECT source_id,
            last_success_at IS NOT NULL
              AND last_success_at > now() - make_interval(secs => 2 * effective_poll_interval_seconds)
              AS is_fresh
       FROM source_runtime_state
      WHERE enabled AND source_id = ANY($1)`,
    [defenseSourceIds],
  );
  const enabledIds = new Set<string>(stateRows.rows.map((r) => r.source_id));
  const freshIds = new Set<string>(
    stateRows.rows.filter((r) => r.is_fresh).map((r) => r.source_id),
  );
  const sourcesWithItems = new Set(rows.map((r) => r.source_id)).size;

  const stateReasons: string[] = [];
  if (enabledIds.size < defenseSourceIds.length) {
    stateReasons.push(
      `enabled_${enabledIds.size}_of_${defenseSourceIds.length}`,
    );
  }
  for (const critical of CRITICAL_DEFENSE_IDS) {
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
    schemaVersion: DEFENSE_PAYLOAD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    state: stateReasons.length === 0 ? "fresh" : "partial",
    stateReasons,
    coverage: {
      manifestSources: defenseSourceIds.length,
      enabledSources: enabledIds.size,
      freshSources: freshIds.size,
      sourcesWithItems,
    },
    analysis,
  };
}

export type StoredDefensePayload = StoredDerivedPayload<DefenseFeedPayload>;

export async function readDefensePayload(
  pool: Pool,
): Promise<StoredDefensePayload | null> {
  return readDerivedPayload<DefenseFeedPayload>(pool, "defense");
}

/** Worker hook: rebuild on new items or when the payload aged out. */
export async function maybeRebuildDefensePayload(
  pool: Pool,
  hasNewItems: boolean,
  buildId = "dev",
): Promise<boolean> {
  if (
    !hasNewItems &&
    (await hasFreshCurrentPayload(pool, "defense", REBUILD_MAX_AGE_SECONDS))
  ) {
    return false;
  }
  const payload = await composeDefensePayload(pool);
  await storeDerivedPayload(pool, "defense", payload, buildId);
  log("info", "defense_payload_built", {
    state: payload.state,
    relevantItems: payload.analysis.relevantItems,
    totalItems: payload.analysis.totalItems,
    sourcesWithItems: payload.coverage.sourcesWithItems,
    reasons: payload.stateReasons.join(",") || null,
  });
  return true;
}
