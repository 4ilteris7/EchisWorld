"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  sourceRegistry,
} from "@/data/source-intelligence/sourceRegistry";
import type {
  IntelligenceEventCandidate,
  NormalizedSourceItem,
  SourceDefinition,
  SourceFilterResult,
} from "@/data/source-intelligence/sourceIntelligenceTypes";
import type { SourceMarkerFeature } from "@/data/source-intelligence/markers/sourceMarkerTypes";
import type {
  GlobalFeedPayload,
  GlobalMarker,
  GlobalSourceStatus,
} from "@/lib/backend/payloads/globalPayload";

// F5 (tam geçiş): the provider no longer fetches 97 upstream sources or runs
// the filter/geo pipeline in the browser. It consumes ONE worker-built payload
// from GET /api/feeds/global; the pipeline already ran server-side. The store
// surface is kept so every existing consumer renders unchanged.

export type SourceIntelligenceLoadState =
  | "loading"
  | "loaded"
  | "partial"
  | "error";

export interface SourceIntelligenceStore {
  sources: SourceDefinition[];
  itemsBySourceId: Record<string, NormalizedSourceItem[]>;
  /** Accurate 48h item count per source (SourcesScreen row stat). */
  itemCountBySourceId: Record<string, number>;
  collectedAtBySourceId: Record<string, string>;
  loadingBySourceId: Record<string, boolean>;
  errorBySourceId: Record<string, string | null>;
  combinedItems: NormalizedSourceItem[];
  /** Legacy field: the filter pass now runs server-side; see rejectedCount. */
  filterResults: SourceFilterResult<NormalizedSourceItem>[];
  /** Items the server-side filter gate rejected in the current window. */
  rejectedCount: number;
  eventCandidates: IntelligenceEventCandidate[];
  markerCandidates: SourceMarkerFeature[];
  loadState: SourceIntelligenceLoadState;
  generatedAt: string | null;
  feedState: ServedGlobalPayload["state"] | "loading";
  pipelineBusy: boolean;
  previewSource: (sourceId: string) => Promise<void>;
  /** Reload installation-local source definitions after a registry mutation. */
  refreshSources: () => Promise<void>;
}

const SourceIntelligenceContext =
  createContext<SourceIntelligenceStore | null>(null);

/** Coalesce refresh requests: at most one payload fetch per window. */
const REFRESH_MIN_INTERVAL_MS = 5_000;

/** Rebuild a minimal item from a candidate whose nested `item` was stripped. */
function candidateToItem(
  candidate: IntelligenceEventCandidate,
): NormalizedSourceItem {
  return {
    id: candidate.id,
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    sourceType: candidate.sourceType,
    collectionMethod: candidate.collectionMethod,
    title: candidate.title,
    summary: candidate.summary,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    collectedAt: candidate.collectedAt,
    sourceBasis: candidate.sourceBasis,
    verificationStatus: candidate.verificationStatus,
    extractionMethod: candidate.extractionMethod,
  };
}

type ServedGlobalPayload = Omit<GlobalFeedPayload, "state"> & {
  state: "fresh" | "partial" | "stale" | "unavailable";
  ageSeconds?: number;
};

type PayloadSnapshot = {
  payload: ServedGlobalPayload | null;
  error: string | null;
};

export function SourceIntelligenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<PayloadSnapshot | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [personalSources, setPersonalSources] = useState<SourceDefinition[]>([]);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchAtRef = useRef(0);
  const mountedRef = useRef(true);

  const fetchPayload = useCallback(async (force = false) => {
    if (inFlightRef.current) return inFlightRef.current;
    if (!force && Date.now() - lastFetchAtRef.current < REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    const run = (async () => {
      setIsFetching(true);
      try {
        const response = await fetch("/api/feeds/global", { cache: "no-store" });
        if (response.status === 503) {
          if (mountedRef.current) {
            setSnapshot((prev) =>
              prev?.payload
                ? { payload: { ...prev.payload, state: "stale" }, error: "feed_unavailable" }
                : { payload: null, error: "feed_unavailable" },
            );
          }
          return;
        }
        if (!response.ok) {
          if (mountedRef.current) {
            setSnapshot((prev) =>
              prev?.payload
                ? { payload: { ...prev.payload, state: "stale" }, error: `feed_${response.status}` }
                : { payload: null, error: `feed_${response.status}` },
            );
          }
          return;
        }
        const payload = (await response.json()) as ServedGlobalPayload;
        if (mountedRef.current) setSnapshot({ payload, error: null });
      } catch {
        if (mountedRef.current) {
          setSnapshot((prev) =>
            prev?.payload
              ? { payload: { ...prev.payload, state: "stale" }, error: "feed_fetch_failed" }
              : { payload: null, error: "feed_fetch_failed" },
          );
        }
      } finally {
        lastFetchAtRef.current = Date.now();
        if (mountedRef.current) setIsFetching(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, []);

  const fetchPersonalSources = useCallback(async () => {
    try {
      const response = await fetch("/api/sources/personal", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as {
        sources?: Array<{ definition?: SourceDefinition }>;
      };
      if (!mountedRef.current) return;
      setPersonalSources(
        (body.sources ?? [])
          .map((entry) => entry.definition)
          .filter((definition): definition is SourceDefinition => Boolean(definition)),
      );
    } catch {
      // Built-in sources remain fully usable when the local registry is absent.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchPayload(true);
    const initialPersonalTimer = window.setTimeout(() => {
      void fetchPersonalSources();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchPayload();
        void fetchPersonalSources();
      }
    }, 60_000);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(initialPersonalTimer);
      window.clearInterval(interval);
    };
  }, [fetchPayload, fetchPersonalSources]);

  // Kept for API compatibility: per-source "preview" now simply refreshes the
  // shared payload (coalesced), because collection happens in the backend.
  const previewSource = useCallback(async () => {
    await fetchPayload(false);
  }, [fetchPayload]);

  const refreshSources = useCallback(async () => {
    await fetchPersonalSources();
    await fetchPayload(true);
  }, [fetchPayload, fetchPersonalSources]);

  const sources = useMemo(
    () => [...sourceRegistry, ...personalSources],
    [personalSources],
  );

  const payload = snapshot?.payload ?? null;

  const eventCandidates = useMemo(
    () => payload?.events ?? [],
    [payload],
  );

  // Markers arrive with `itemIds` instead of embedded events (no on-wire
  // duplication). Rehydrate `items` from the events array so every downstream
  // consumer (globe activity snapshot, marker popup) sees the same
  // SourceMarkerFeature shape it always has.
  const markerCandidates = useMemo<SourceMarkerFeature[]>(() => {
    const markers = payload?.markers;
    if (!markers || markers.length === 0) return [];
    const eventsById = new Map(eventCandidates.map((event) => [event.id, event]));
    return markers.map((marker: GlobalMarker): SourceMarkerFeature => {
      const { itemIds, ...rest } = marker;
      const items = itemIds
        .map((id) => eventsById.get(id))
        .filter((event): event is IntelligenceEventCandidate => Boolean(event));
      return { ...rest, items };
    });
  }, [payload, eventCandidates]);
  // The served payload strips candidate.item (§16 size); reconstruct a minimal
  // NormalizedSourceItem from the candidate's own top-level fields for the two
  // legacy store outputs that expose item lists.
  const combinedItems = useMemo(
    () => eventCandidates.map(candidateToItem),
    [eventCandidates],
  );
  const itemsBySourceId = useMemo(() => {
    const grouped: Record<string, NormalizedSourceItem[]> = {};
    for (const candidate of eventCandidates) {
      (grouped[candidate.sourceId] ??= []).push(candidateToItem(candidate));
    }
    return grouped;
  }, [eventCandidates]);

  const sourceStatusById = useMemo(() => {
    const map = new Map<string, GlobalSourceStatus>();
    for (const status of payload?.sourceStatus ?? []) {
      map.set(status.sourceId, status);
    }
    return map;
  }, [payload]);

  const itemCountBySourceId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [sourceId, status] of sourceStatusById) {
      counts[sourceId] = status.itemCount48h;
    }
    return counts;
  }, [sourceStatusById]);

  const collectedAtBySourceId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [sourceId, status] of sourceStatusById) {
      if (status.lastSuccessAt) map[sourceId] = status.lastSuccessAt;
    }
    return map;
  }, [sourceStatusById]);

  const errorBySourceId = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const [sourceId, status] of sourceStatusById) {
      map[sourceId] = status.lastErrorCode ?? null;
    }
    return map;
  }, [sourceStatusById]);

  // Collection happens in the backend worker; nothing is "loading" per-source.
  const loadingBySourceId = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const source of sourceRegistry) map[source.id] = false;
    for (const source of personalSources) map[source.id] = false;
    return map;
  }, [personalSources]);

  const loadState = useMemo((): SourceIntelligenceLoadState => {
    if (!snapshot) return "loading";
    if (!payload) {
      return isFetching ? "loading" : "error";
    }
    if (payload.state === "fresh") return "loaded";
    return "partial"; // partial or stale: data exists but is degraded/aged
  }, [snapshot, payload, isFetching]);

  const value = useMemo<SourceIntelligenceStore>(
    () => ({
      sources,
      itemsBySourceId,
      itemCountBySourceId,
      collectedAtBySourceId,
      loadingBySourceId,
      errorBySourceId,
      combinedItems,
      filterResults: [],
      rejectedCount: payload?.rejectedCount ?? 0,
      eventCandidates,
      markerCandidates,
      loadState,
      generatedAt: payload?.generatedAt ?? null,
      feedState: payload?.state ?? (isFetching ? "loading" : "unavailable"),
      pipelineBusy: isFetching,
      previewSource,
      refreshSources,
    }),
    [
      combinedItems,
      collectedAtBySourceId,
      errorBySourceId,
      eventCandidates,
      isFetching,
      itemCountBySourceId,
      itemsBySourceId,
      loadState,
      loadingBySourceId,
      markerCandidates,
      payload,
      previewSource,
      refreshSources,
      sources,
    ],
  );

  return (
    <SourceIntelligenceContext.Provider value={value}>
      {children}
    </SourceIntelligenceContext.Provider>
  );
}

export function useSourceIntelligenceStore(): SourceIntelligenceStore {
  const ctx = useContext(SourceIntelligenceContext);
  if (!ctx) {
    throw new Error(
      "useSourceIntelligenceStore must be used within a <SourceIntelligenceProvider>.",
    );
  }
  return ctx;
}
