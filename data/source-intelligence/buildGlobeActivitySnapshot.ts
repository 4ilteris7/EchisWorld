import type { SourceMarkerFeature } from "@/data/source-intelligence/markers/sourceMarkerTypes";
import type {
  IntelligenceEventCandidate,
} from "@/data/source-intelligence/sourceIntelligenceTypes";
import {
  GLOBE_ACTIVITY_SNAPSHOT_VERSION,
  type GlobeActivityGeoConfidence,
  type GlobeActivityPoint,
  type GlobeActivitySnapshot,
  type GlobeActivitySnapshotState,
} from "@/types/globe-activity";

const ACTIVITY_WINDOW_HOURS = 24;
const SNAPSHOT_FRESHNESS_MS = 10 * 60 * 1000;

type BuildGlobeActivitySnapshotInput = {
  items: IntelligenceEventCandidate[];
  markers: SourceMarkerFeature[];
  loadState: "loading" | "loaded" | "partial" | "error";
  now?: number;
  /** Provenance of the snapshot. Defaults to the browser pipeline. */
  sourceMode?: GlobeActivitySnapshot["sourceMode"];
};

function eventTime(item: IntelligenceEventCandidate): number {
  return new Date(item.publishedAt ?? item.collectedAt ?? 0).getTime();
}

function newestIso(values: Array<string | undefined>): string | null {
  const newest = values.reduce((latest, value) => {
    if (!value) return latest;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);
  return newest > 0 ? new Date(newest).toISOString() : null;
}

function snapshotState(
  loadState: BuildGlobeActivitySnapshotInput["loadState"],
): GlobeActivitySnapshotState {
  if (loadState === "loaded") return "fresh";
  if (loadState === "partial") return "partial";
  if (loadState === "error") return "unavailable";
  return "loading";
}

// Marker levels are RELATIVE to the current snapshot, not fixed score bands.
// Absolute thresholds collapse everything into one level (the globe only shows
// high-priority events); a share-based split keeps a lively high/medium/low mix
// no matter how the priority scale drifts. Tuned high-leaning so the welcome
// globe stays busy: the top locations stay "high", the rest fill in below.
const HIGH_SHARE = 0.45; // top 45% of located markers → high
const MEDIUM_SHARE = 0.3; // next 30% → medium; bottom 25% → low

function assignRelativeLevels(scored: ScoredPoint[]): void {
  if (scored.length === 0) return;
  const sorted = [...scored].map((s) => s.score).sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const highThreshold = at(1 - HIGH_SHARE);
  const mediumThreshold = at(1 - HIGH_SHARE - MEDIUM_SHARE);
  for (const s of scored) {
    s.point.level =
      s.score >= highThreshold
        ? "high"
        : s.score >= mediumThreshold
          ? "medium"
          : "low";
  }
}

type ScoredPoint = { point: GlobeActivityPoint; score: number };

function geoConfidence(
  marker: SourceMarkerFeature,
): GlobeActivityGeoConfidence {
  const acceptedEvidence = marker.candidate.geoBasis.evidenceDetails?.filter(
    (evidence) => evidence.acceptedForMarker,
  );
  return acceptedEvidence?.some((evidence) => evidence.strength === "strong")
    ? "high"
    : "medium";
}

function pointFromMarker(
  marker: SourceMarkerFeature,
  cutoff: number,
): ScoredPoint | null {
  const recentItems = marker.items.filter((item) => eventTime(item) >= cutoff);
  if (recentItems.length === 0) return null;

  const lead = recentItems.reduce((best, item) =>
    item.priorityScore > best.priorityScore ? item : best,
  );
  const observedAt = newestIso(
    recentItems.flatMap((item) => [item.publishedAt, item.collectedAt]),
  );
  if (!observedAt) return null;

  return {
    score: Math.max(...recentItems.map((item) => item.priorityScore)),
    point: {
      id: marker.id,
      lng: marker.lng,
      lat: marker.lat,
      locationLabel: marker.locationName,
      headline: lead.title,
      sourceName: lead.sourceName,
      sourceUrl: lead.url,
      sourceBasis: lead.sourceBasis,
      collectionMethod: lead.collectionMethod,
      publishedAt: lead.publishedAt,
      observedAt,
      itemCount: recentItems.length,
      sourceCount: new Set(recentItems.map((item) => item.sourceId)).size,
      // Placeholder — assigned relatively once all points are known.
      level: "low",
      geoConfidence: geoConfidence(marker),
    },
  };
}

export function buildGlobeActivitySnapshot({
  items,
  markers,
  loadState,
  now = Date.now(),
  sourceMode = "visitor_pipeline",
}: BuildGlobeActivitySnapshotInput): GlobeActivitySnapshot {
  const cutoff = now - ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000;
  const scored = markers
    .map((marker) => pointFromMarker(marker, cutoff))
    .filter((scoredPoint): scoredPoint is ScoredPoint => scoredPoint !== null);
  // Assign high/medium/low relative to this snapshot's own score spread.
  assignRelativeLevels(scored);
  const allPoints = scored
    .map((s) => s.point)
    .sort((a, b) => {
      const levelRank = { high: 3, medium: 2, low: 1 } as const;
      const levelDifference = levelRank[b.level] - levelRank[a.level];
      if (levelDifference !== 0) return levelDifference;
      return new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
    });
  const points = allPoints;

  const generatedAt = newestIso(items.map((item) => item.collectedAt));
  const expiresAt = generatedAt
    ? new Date(new Date(generatedAt).getTime() + SNAPSHOT_FRESHNESS_MS).toISOString()
    : null;

  return {
    schemaVersion: GLOBE_ACTIVITY_SNAPSHOT_VERSION,
    sourceMode,
    state: snapshotState(loadState),
    generatedAt,
    expiresAt,
    windowHours: ACTIVITY_WINDOW_HOURS,
    totalItemCount: items.length,
    geolocatedItemCount: allPoints.reduce(
      (count, point) => count + point.itemCount,
      0,
    ),
    points,
  };
}
