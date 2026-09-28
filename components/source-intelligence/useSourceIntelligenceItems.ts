"use client";

import { useSourceIntelligenceStore } from "./SourceIntelligenceProvider";

export function useSourceIntelligenceItems() {
  const store = useSourceIntelligenceStore();
  return {
    items: store.eventCandidates,
    normalizedItems: store.combinedItems,
    filterResults: store.filterResults,
    markers: store.markerCandidates,
    loadState: store.loadState,
    generatedAt: store.generatedAt,
    feedState: store.feedState,
    pipelineBusy: store.pipelineBusy,
    loadingBySourceId: store.loadingBySourceId,
    errorBySourceId: store.errorBySourceId,
    previewSource: store.previewSource,
  };
}
