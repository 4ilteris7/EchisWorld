// Policy Dossier derived payload (F4B) — worker-built, same contract as the
// Cyber/Defense payloads. The Policy detection engine (lib/policy) runs here
// once; the state-affiliation transparency flag (§ roadmap F4: "State-
// affiliation ve diğer şeffaflık alanları korunur") is stamped server-side
// from the shared documented source set.

import type { Pool } from "pg";
import {
  analyzePolicySignals,
  type PolicySignalInput,
} from "@/lib/policy";
import type { PolicyAnalysisResult } from "@/lib/policy/types";
import { STATE_AFFILIATED_SOURCE_IDS } from "@/lib/policy/stateAffiliation";
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

export const POLICY_PAYLOAD_SCHEMA_VERSION = 1;
export const POLICY_PAYLOAD_STALE_AFTER_SECONDS = 30 * 60;
const REBUILD_MAX_AGE_SECONDS = 15 * 60;
// Cap removed by request (was roadmap §16's top-200). Still bounded: the query
// reads the 48-hour rolling window `collected_items` keeps, not all history.

export type PolicyPayloadState = "fresh" | "partial";

export type PolicyFeedPayload = {
  schemaVersion: typeof POLICY_PAYLOAD_SCHEMA_VERSION;
  generatedAt: string;
  state: PolicyPayloadState;
  stateReasons: string[];
  coverage: {
    manifestSources: number;
    enabledSources: number;
    freshSources: number;
    sourcesWithItems: number;
  };
  /** Finished screen analysis; items carry the stateAffiliated flag. */
  analysis: PolicyAnalysisResult;
};

const CRITICAL_POLICY_IDS = CANONICAL_SOURCE_MANIFEST.filter(
  (entry) => entry.critical && entry.targetScreens.includes("policy"),
).map((entry) => entry.sourceId);
/** Compose from the current 48h window. Pure read; no swap. */
export async function composePolicyPayload(
  pool: Pool,
): Promise<PolicyFeedPayload> {
  const catalog = await loadEffectiveSourceCatalog(pool);
  const policySourceIds = catalog.sourceIdsForScreen("policy");
  const { rows } = await pool.query(
    `SELECT source_id, upstream_item_id, fingerprint, title, summary, url,
            published_at, collected_at, verification
       FROM collected_items
      WHERE source_id = ANY($1)
      ORDER BY published_at DESC NULLS LAST, collected_at DESC`,
    [policySourceIds],
  );

  const itemIdToSourceId = new Map<string, string>();
  const inputs: PolicySignalInput[] = rows.map((row) => {
    const id = `${row.source_id}::${row.upstream_item_id ?? row.fingerprint}`;
    itemIdToSourceId.set(id, row.source_id);
    const sourceName = catalog.sourceNameById.get(row.source_id) ?? row.source_id;
    return {
      id,
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

  const analysis = analyzePolicySignals(inputs);

  // Transparency badge: flag items whose ORIGIN outlet is documented as
  // state-owned/state-funded. Report ids pass through the engine unchanged.
  const items = analysis.items.map((item) => {
    const sourceId = itemIdToSourceId.get(item.id);
    return sourceId && STATE_AFFILIATED_SOURCE_IDS.has(sourceId)
      ? { ...item, stateAffiliated: true }
      : item;
  });

  const stateRows = await pool.query(
    `SELECT source_id,
            last_success_at IS NOT NULL
              AND last_success_at > now() - make_interval(secs => 2 * effective_poll_interval_seconds)
              AS is_fresh
       FROM source_runtime_state
      WHERE enabled AND source_id = ANY($1)`,
    [policySourceIds],
  );
  const enabledIds = new Set<string>(stateRows.rows.map((r) => r.source_id));
  const freshIds = new Set<string>(
    stateRows.rows.filter((r) => r.is_fresh).map((r) => r.source_id),
  );
  const sourcesWithItems = new Set(rows.map((r) => r.source_id)).size;

  const stateReasons: string[] = [];
  if (enabledIds.size < policySourceIds.length) {
    stateReasons.push(
      `enabled_${enabledIds.size}_of_${policySourceIds.length}`,
    );
  }
  for (const critical of CRITICAL_POLICY_IDS) {
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
    schemaVersion: POLICY_PAYLOAD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    state: stateReasons.length === 0 ? "fresh" : "partial",
    stateReasons,
    coverage: {
      manifestSources: policySourceIds.length,
      enabledSources: enabledIds.size,
      freshSources: freshIds.size,
      sourcesWithItems,
    },
    analysis: { ...analysis, items },
  };
}

export type StoredPolicyPayload = StoredDerivedPayload<PolicyFeedPayload>;

export async function readPolicyPayload(
  pool: Pool,
): Promise<StoredPolicyPayload | null> {
  return readDerivedPayload<PolicyFeedPayload>(pool, "policy");
}

/** Worker hook: rebuild on new items or when the payload aged out. */
export async function maybeRebuildPolicyPayload(
  pool: Pool,
  hasNewItems: boolean,
  buildId = "dev",
): Promise<boolean> {
  if (
    !hasNewItems &&
    (await hasFreshCurrentPayload(pool, "policy", REBUILD_MAX_AGE_SECONDS))
  ) {
    return false;
  }
  const payload = await composePolicyPayload(pool);
  await storeDerivedPayload(pool, "policy", payload, buildId);
  log("info", "policy_payload_built", {
    state: payload.state,
    relevantItems: payload.analysis.relevantItems,
    totalItems: payload.analysis.totalItems,
    sourcesWithItems: payload.coverage.sourcesWithItems,
    reasons: payload.stateReasons.join(",") || null,
  });
  return true;
}
