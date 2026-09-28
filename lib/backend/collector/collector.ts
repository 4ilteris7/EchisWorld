// Collector orchestration (F2D): due sources → safe fetch → parse → dedupe →
// persist → adapt schedule → bookkeeping. One cycle per worker tick.
//
// Constraints honored here (roadmap §8.2, §22.4):
//   - global concurrency is small and per-host requests are serialized
//   - conditional GET via stored etag/last-modified; 304 counts as success
//   - no raw XML/body persistence — parsed metadata only
//   - every attempt leaves a technical trace in collector_source_results

import type { Pool } from "pg";
import type { SourceDefinition as LegacySourceDefinition } from "@/data/sources/sourceTypes";
import { parseRssPreviewItemsFromXml } from "@/lib/sources/rssPreviewAdapter";
import { parsePublicJsonFeedItems } from "@/lib/sources/publicJsonFeedAdapter";
import { canonicalItemFromScreenItem } from "@/lib/backend/contracts/canonicalItem";
import {
  API_SOURCE_FETCHERS,
  type ApiSourceFetcher,
} from "@/lib/backend/collector/apiAdapters";
import {
  type CanonicalSourceManifestEntry,
} from "@/lib/backend/sources/manifest";
import { loadEffectiveSourceCatalog } from "@/lib/backend/sources/effectiveCatalog";
import {
  personalSourceToManifestEntry,
  type PersonalConnectorType,
} from "@/lib/backend/sources/personalSources";
import {
  safeFetch,
  SafeFetchError,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "@/lib/backend/collector/safeFetch";
import {
  decideNextPoll,
  type FetchOutcome,
} from "@/lib/backend/collector/schedule";
import {
  findDueSources,
  ensureSourceStateRows,
  recordSourceAttempt,
  type DueSource,
} from "@/lib/backend/repositories/sourceStateRepo";
import {
  insertItems,
  observedPublishIntervalSeconds,
} from "@/lib/backend/repositories/itemsRepo";
import {
  completeRun,
  recordSourceResult,
  startRun,
} from "@/lib/backend/repositories/runsRepo";
import { log } from "@/lib/backend/observability/log";

export type Fetcher = (
  url: string,
  options: SafeFetchOptions,
) => Promise<SafeFetchResult>;

export type CollectorOptions = {
  /** Max sources processed per cycle. */
  batchLimit?: number;
  /** Hosts processed in parallel; requests within a host are sequential. */
  hostConcurrency?: number;
  buildId?: string;
  /** Injected for tests; defaults to the hardened safeFetch. */
  fetcher?: Fetcher;
  /** Injected for tests; defaults to the real API adapters. */
  apiFetchers?: Record<string, ApiSourceFetcher>;
  fetchOptions?: Pick<SafeFetchOptions, "allowPrivateHosts">;
};

export type CycleSummary = {
  runId: number | null;
  attempted: number;
  succeeded: number;
  notModified: number;
  newItems: number;
  duplicates: number;
  errors: number;
  durationMs: number;
};

/** Extract the RSS <ttl> hint (minutes) as seconds, when present. */
export function rssTtlSeconds(xml: string): number | undefined {
  const match = xml.match(/<ttl>\s*(\d{1,5})\s*<\/ttl>/i);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  return minutes > 0 ? minutes * 60 : undefined;
}

/** Group due sources by endpoint host so one slow host never sees bursts. */
export function groupByHost(
  due: readonly DueSource[],
  entryFor: (sourceId: string) => CanonicalSourceManifestEntry | undefined,
): DueSource[][] {
  const byHost = new Map<string, DueSource[]>();
  for (const source of due) {
    const endpoint = entryFor(source.sourceId)?.endpoint;
    let host = "unknown";
    try {
      host = endpoint ? new URL(endpoint).hostname : "unknown";
    } catch {
      // keep "unknown" bucket; validation happens at fetch time
    }
    const bucket = byHost.get(host);
    if (bucket) bucket.push(source);
    else byHost.set(host, [source]);
  }
  return [...byHost.values()];
}

function classifyFailure(err: unknown): {
  outcome: FetchOutcome;
  errorCode: string;
  httpStatus?: number;
} {
  if (err instanceof SafeFetchError) {
    const category =
      err.code === "timeout" || err.code === "network_error"
        ? "temporary"
        : "blocked";
    return { outcome: { kind: "error", category }, errorCode: err.code };
  }
  return {
    outcome: { kind: "error", category: "temporary" },
    errorCode: "unexpected_error",
  };
}

async function collectOneSource(
  pool: Pool,
  runId: number,
  source: DueSource,
  entry: CanonicalSourceManifestEntry,
  legacyDef: LegacySourceDefinition | undefined,
  personalConnector: PersonalConnectorType | undefined,
  fetcher: Fetcher,
  apiFetchers: Record<string, ApiSourceFetcher>,
  fetchOptions: CollectorOptions["fetchOptions"],
): Promise<{ ok: boolean; notModified: boolean; newItems: number; duplicates: number }> {
  let response: SafeFetchResult | undefined;
  let outcome: FetchOutcome;
  let errorCode: string | undefined;
  let parsedCount = 0;
  let inserted = 0;
  let duplicates = 0;
  let ttlHint: number | undefined;

  try {
    if (!legacyDef) throw new SafeFetchError("invalid_url", "unknown source id");

    if (entry.collectionMethod !== "rss" && personalConnector !== "json") {
      // Quota-limited API source: the provider adapter does its own fetch
      // with server-side keys; conditional GET does not apply.
      const apiFetcher = apiFetchers[source.sourceId];
      if (!apiFetcher) throw new SafeFetchError("invalid_url", "no api adapter");
      const started = performance.now();
      const legacyItems = await apiFetcher(legacyDef);
      const durationMs = Math.round(performance.now() - started);
      response = {
        status: 200,
        notModified: false,
        finalUrl: entry.endpoint,
        redirects: 0,
        durationMs,
        bytes: 0,
      };
      parsedCount = legacyItems.length;
      const batch = await insertItems(
        pool,
        legacyItems.map(canonicalItemFromScreenItem),
      );
      inserted = batch.inserted;
      duplicates = batch.duplicates;
      outcome =
        inserted > 0
          ? { kind: "new_items", newItems: inserted, parsedItems: parsedCount }
          : { kind: "unchanged" };
    } else {
      response = await fetcher(entry.endpoint, {
        etag: source.etag,
        lastModified: source.lastModified,
        timeoutMs: entry.limits?.timeoutMs,
        maxBodyBytes: entry.limits?.maxBodyBytes,
        accept: personalConnector === "json"
          ? "application/feed+json, application/json;q=0.9"
          : undefined,
        ...fetchOptions,
      });

      if (response.notModified) {
        outcome = { kind: "not_modified" };
      } else if (response.status === 429) {
        outcome = { kind: "error", category: "rate_limited" };
        errorCode = "upstream_429";
      } else if (response.status < 200 || response.status >= 300) {
        outcome = {
          kind: "error",
          category: response.status === 403 ? "blocked" : "temporary",
        };
        errorCode = `upstream_${response.status}`;
      } else {
        const body = response.body ?? "";
        ttlHint = personalConnector === "json" ? undefined : rssTtlSeconds(body);
        const legacyItems = personalConnector === "json"
          ? parsePublicJsonFeedItems(legacyDef, body, new Date().toISOString())
          : parseRssPreviewItemsFromXml(
              legacyDef,
              body,
              new Date().toISOString(),
            );
        parsedCount = legacyItems.length;
        const canonical = legacyItems.map(canonicalItemFromScreenItem);
        const batch = await insertItems(pool, canonical);
        inserted = batch.inserted;
        duplicates = batch.duplicates;
        outcome =
          inserted > 0
            ? { kind: "new_items", newItems: inserted, parsedItems: parsedCount }
            : { kind: "unchanged" };
      }
    }
  } catch (err) {
    const failure = classifyFailure(err);
    outcome = failure.outcome;
    errorCode = errorCode ?? failure.errorCode;
  }

  const observed =
    outcome.kind === "new_items"
      ? await observedPublishIntervalSeconds(pool, source.sourceId)
      : undefined;

  const decision = decideNextPoll(
    entry.schedule,
    {
      ...source.state,
      rssTtlHintSeconds: ttlHint ?? source.state.rssTtlHintSeconds,
      cacheControlMaxAgeSeconds:
        response?.cacheControlMaxAgeSeconds ??
        source.state.cacheControlMaxAgeSeconds,
      observedPublishIntervalSeconds:
        observed ?? source.state.observedPublishIntervalSeconds,
    },
    outcome,
  );

  const success = outcome.kind !== "error";
  await recordSourceAttempt(pool, {
    sourceId: source.sourceId,
    decision,
    success,
    contentChanged: outcome.kind === "new_items",
    httpStatus: response?.status,
    errorCode,
    durationMs: response?.durationMs,
    newItemCount: outcome.kind === "new_items" ? inserted : 0,
    etag: response?.etag,
    lastModified: response?.lastModified,
    rssTtlHintSeconds: ttlHint,
    cacheControlMaxAgeSeconds: response?.cacheControlMaxAgeSeconds,
    observedPublishIntervalSeconds: observed,
  });
  await recordSourceResult(pool, runId, {
    sourceId: source.sourceId,
    httpStatus: response?.status,
    durationMs: response?.durationMs,
    parsedItems: parsedCount,
    newItems: inserted,
    duplicateItems: duplicates,
    notModified: outcome.kind === "not_modified",
    errorCode,
  });

  return {
    ok: success,
    notModified: outcome.kind === "not_modified",
    newItems: inserted,
    duplicates,
  };
}

/**
 * Run one collection cycle: process every due source once. Returns aggregate
 * counts; detailed per-source traces live in collector_source_results.
 */
export async function runCollectorCycle(
  pool: Pool,
  options: CollectorOptions = {},
): Promise<CycleSummary> {
  const started = performance.now();
  const batchLimit = options.batchLimit ?? 40;
  const hostConcurrency = options.hostConcurrency ?? 4;
  const fetcher = options.fetcher ?? safeFetch;
  const apiFetchers = options.apiFetchers ?? API_SOURCE_FETCHERS;

  // Personal sources can be added while the worker is already running. Sync
  // their scheduler rows on every cycle so no restart is required.
  const catalog = await loadEffectiveSourceCatalog(pool);
  const allPersonalEntries = catalog.personalSources.map(personalSourceToManifestEntry);
  await ensureSourceStateRows(pool, allPersonalEntries);
  const enabledPersonalIds = catalog.personalSources
    .filter((source) => source.enabled)
    .map((source) => source.sourceId);
  await pool.query(
    `UPDATE source_runtime_state
        SET enabled = source_id = ANY($1::text[]), updated_at = now()
      WHERE source_id LIKE 'personal-%'`,
    [enabledPersonalIds],
  );
  const personalById = new Map(
    catalog.personalSources.map((source) => [source.sourceId, source]),
  );

  const due = await findDueSources(pool, batchLimit);
  if (due.length === 0) {
    return {
      runId: null,
      attempted: 0,
      succeeded: 0,
      notModified: 0,
      newItems: 0,
      duplicates: 0,
      errors: 0,
      durationMs: Math.round(performance.now() - started),
    };
  }

  const runId = await startRun(pool, options.buildId ?? "dev");
  const summary = {
    attempted: 0,
    succeeded: 0,
    notModified: 0,
    newItems: 0,
    duplicates: 0,
    errors: 0,
  };

  const hostGroups = groupByHost(due, (sourceId) => catalog.entryById.get(sourceId));
  let cursor = 0;
  async function lane(): Promise<void> {
    while (cursor < hostGroups.length) {
      const group = hostGroups[cursor++];
      for (const source of group) {
        const entry = catalog.entryById.get(source.sourceId);
        if (!entry) continue;
        summary.attempted += 1;
        const result = await collectOneSource(
          pool,
          runId,
          source,
          entry,
          catalog.legacyById.get(source.sourceId),
          personalById.get(source.sourceId)?.connectorType,
          fetcher,
          apiFetchers,
          options.fetchOptions,
        );
        if (result.ok) summary.succeeded += 1;
        else summary.errors += 1;
        if (result.notModified) summary.notModified += 1;
        summary.newItems += result.newItems;
        summary.duplicates += result.duplicates;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(hostConcurrency, hostGroups.length) }, lane),
  );

  const durationMs = Math.round(performance.now() - started);
  await completeRun(pool, runId, {
    attemptedSources: summary.attempted,
    succeededSources: summary.succeeded,
    newItems: summary.newItems,
    duplicateItems: summary.duplicates,
    rejectedItems: 0,
    totalDurationMs: durationMs,
  });

  log("info", "collector_cycle", {
    runId,
    attempted: summary.attempted,
    succeeded: summary.succeeded,
    notModified: summary.notModified,
    newItems: summary.newItems,
    duplicates: summary.duplicates,
    errors: summary.errors,
    durationMs,
  });

  return { runId, ...summary, durationMs };
}
