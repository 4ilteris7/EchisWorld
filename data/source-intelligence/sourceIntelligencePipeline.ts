import { applySourceFilters } from "./filters/applySourceFilters";
import { resolveGeoBasis } from "./geo/resolveGeoBasis";
import {
  addGeoDecisionEngineMs,
  incrementGeoProcessedCount,
  readPipelineStageProfile,
  resetPipelineStageProfile,
} from "./pipelineProfiling";
import type {
  IntelligenceEventCandidate,
  NormalizedSourceItem,
  SourcePipelineProfile,
  SourceDefinition,
  SourceFilterResult,
} from "./sourceIntelligenceTypes";

const GLOBAL_VIEW_MAX_ITEM_AGE_MS = 48 * 60 * 60 * 1000;

function isFreshEnough(item: NormalizedSourceItem): boolean {
  if (!item.publishedAt || !item.collectedAt) return true;
  const published = new Date(item.publishedAt).getTime();
  const collected = new Date(item.collectedAt).getTime();
  if (Number.isNaN(published) || Number.isNaN(collected)) return true;
  return collected - published < GLOBAL_VIEW_MAX_ITEM_AGE_MS;
}

// ---------------------------------------------------------------------------
// Geo-resolution cache — persists across useMemo re-runs so items resolved
// in a previous pipeline pass are not re-resolved when new sources arrive.
//
// Key  : NormalizedSourceItem.id — stable for the lifetime of an RSS article.
// Value: the three fields written back onto IntelligenceEventCandidate after
//        resolveGeoBasis().
//
// Safety:
//   • Item IDs are derived from content URLs and do not change between fetches.
//   • Source definitions are static module-level constants; the resolution
//     logic for a given sourceId never changes at runtime.
//   • resolveGeoBasis is a pure function of (candidate, source).
//
// A hard cap prevents unbounded growth during long browser sessions.
// ---------------------------------------------------------------------------
type _GeoCacheEntry = {
  markerEligibility: IntelligenceEventCandidate["markerEligibility"];
  geoBasis:          IntelligenceEventCandidate["geoBasis"];
  resolvedLocation:  IntelligenceEventCandidate["resolvedLocation"];
  markerAnchor:      IntelligenceEventCandidate["markerAnchor"];
  markerReason:      IntelligenceEventCandidate["markerReason"];
  noMarkerReason:    IntelligenceEventCandidate["noMarkerReason"];
};
const _geoCache    = new Map<string, _GeoCacheEntry>();
const _GEO_CAP     = 4000;

export function buildIntelligenceEventCandidates(
  filterResults: SourceFilterResult<NormalizedSourceItem>[],
  sourceLookup: (sourceId: string) => SourceDefinition | undefined,
): IntelligenceEventCandidate[] {
  return filterResults
    .filter((result) => result.accepted && result.primaryDomain)
    .map((result): IntelligenceEventCandidate => {
      const source = sourceLookup(result.item.sourceId);
      const initial: IntelligenceEventCandidate = {
        id: result.item.id,
        item: result.item,
        title: result.item.title,
        summary: result.item.summary,
        url: result.item.url,
        sourceId: result.item.sourceId,
        sourceName: result.item.sourceName,
        sourceType: result.item.sourceType,
        collectionMethod: result.item.collectionMethod,
        publishedAt: result.item.publishedAt,
        collectedAt: result.item.collectedAt,
        primaryDomain: result.primaryDomain!,
        tags: result.tags,
        relevanceScore: result.relevanceScore,
        priorityScore: result.priorityScore,
        sourceBasis: result.sourceBasis,
        verificationStatus: result.verificationStatus,
        extractionMethod: result.extractionMethod,
        matchedKeywords: result.matchedKeywords,
        matches: result.matches,
        markerEligibility: result.markerEligibility,
        geoBasis: result.geoBasis,
        eventType: result.eventType,
        eventSubType: result.eventSubType,
        entityRoles: result.entityRoles,
        markerAnchor: result.markerAnchor,
        markerReason: result.markerReason,
        noMarkerReason: result.noMarkerReason,
        contextReasons: result.contextReasons,
        filterGuardReason: result.filterGuardReason,
      };

      if (!source) return initial;
      if (
        initial.markerEligibility === "feed_only" ||
        initial.markerEligibility === "rejected"
      ) {
        return initial;
      }

      // Return cached geo-resolution when available — avoids re-running the
      // expensive findLocationResolutionCandidates() regex scan for items that
      // were already resolved in a prior pipeline pass.
      const cached = _geoCache.get(result.item.id);
      if (cached) {
        return {
          ...initial,
          markerEligibility: cached.markerEligibility,
          geoBasis:          cached.geoBasis,
          resolvedLocation:  cached.resolvedLocation,
          markerAnchor:      cached.markerAnchor,
          markerReason:      cached.markerReason,
          noMarkerReason:    cached.noMarkerReason,
        };
      }

      const geoStart = performance.now();
      const resolved = resolveGeoBasis(initial, source);
      addGeoDecisionEngineMs(performance.now() - geoStart);
      incrementGeoProcessedCount();
      const entry: _GeoCacheEntry = {
        markerEligibility: resolved.markerEligibility,
        geoBasis:          resolved.geoBasis,
        resolvedLocation:  resolved.location,
        markerAnchor:      resolved.markerAnchor,
        markerReason:      resolved.markerReason,
        noMarkerReason:    resolved.noMarkerReason,
      };
      if (_geoCache.size < _GEO_CAP) _geoCache.set(result.item.id, entry);

      // Cache the resolved coordinates on the candidate so sourceItemsToMarkers
      // can place the globe pin without running resolveGeoBasis a second time.
      return {
        ...initial,
        markerEligibility: entry.markerEligibility,
        geoBasis:          entry.geoBasis,
        resolvedLocation:  entry.resolvedLocation,
        markerAnchor:      entry.markerAnchor,
        markerReason:      entry.markerReason,
        noMarkerReason:    entry.noMarkerReason,
      };
    })
    .sort((a, b) => {
      const scoreDelta = b.priorityScore - a.priorityScore;
      if (scoreDelta !== 0) return scoreDelta;
      return (
        new Date(b.publishedAt ?? b.collectedAt ?? 0).getTime() -
        new Date(a.publishedAt ?? a.collectedAt ?? 0).getTime()
      );
    });
}

export function runSourceIntelligencePipeline(
  normalizedItems: NormalizedSourceItem[],
  sourceLookup: (sourceId: string) => SourceDefinition | undefined,
): {
  normalizedItems: NormalizedSourceItem[];
  filterResults: SourceFilterResult<NormalizedSourceItem>[];
  eventCandidates: IntelligenceEventCandidate[];
  profile: SourcePipelineProfile;
} {
  const totalStart = performance.now();
  resetPipelineStageProfile();
  const freshItems = normalizedItems.filter(isFreshEnough);
  const filterStart = performance.now();
  const filterResults = applySourceFilters(freshItems);
  const applySourceFiltersMs = performance.now() - filterStart;
  const eventCandidates = buildIntelligenceEventCandidates(
    filterResults,
    sourceLookup,
  );
  const stageProfile = readPipelineStageProfile();
  const totalMs = performance.now() - totalStart;
  const feedOnlyCount = eventCandidates.filter(
    (item) => item.markerEligibility === "feed_only",
  ).length;
  const markerEligibleCount = eventCandidates.filter(
    (item) => item.markerEligibility === "eligible",
  ).length;
  const rejectedCount = filterResults.filter((item) => !item.accepted).length;

  return {
    normalizedItems: freshItems,
    filterResults,
    eventCandidates,
    profile: {
      itemCount: normalizedItems.length,
      freshItemCount: freshItems.length,
      cheapPrefilterRejectedCount: stageProfile.cheapPrefilterRejectedCount,
      fullContextProcessedCount: stageProfile.fullContextProcessedCount,
      geoProcessedCount: stageProfile.geoProcessedCount,
      feedOnlyCount,
      rejectedCount,
      markerEligibleCount,
      applySourceFiltersMs,
      eventEntityDetectionMs: stageProfile.eventEntityDetectionMs,
      geoDecisionEngineMs: stageProfile.geoDecisionEngineMs,
      totalMs,
    },
  };
}
