// Globe activity snapshot derived payload (F6A). Built by the worker from the
// same 48h pipeline result as the global payload, then served to the welcome
// globe from PostgreSQL — satisfies AGENTS.md §6's requirement that the live
// globe reads a persisted snapshot, not a visitor-triggered pipeline.

import type { Pool } from "pg";
import { buildGlobeActivitySnapshot } from "@/data/source-intelligence/buildGlobeActivitySnapshot";
import { sourceItemsToMarkers } from "@/data/source-intelligence/markers/sourceItemsToMarkers";
import type { IntelligenceEventCandidate } from "@/data/source-intelligence/sourceIntelligenceTypes";
import type { GlobeActivitySnapshot } from "@/types/globe-activity";
import {
  readDerivedPayload,
  storeDerivedPayload,
  type StoredDerivedPayload,
} from "@/lib/backend/payloads/payloadStore";
import { log } from "@/lib/backend/observability/log";

export const GLOBE_SNAPSHOT_STALE_AFTER_SECONDS = 30 * 60;

// The welcome globe is built from ALL accepted events, so it stays populated
// with many locations. (The feed was once limited to the top 200; that cap is
// gone, so both now draw from the same full set.) Still bounded here so a very
// busy news day can't produce an unrenderable cloud of pins.
const MAX_GLOBE_MARKERS = 120;

function markerScore(marker: { items: IntelligenceEventCandidate[] }): number {
  return marker.items.reduce((max, item) => Math.max(max, item.priorityScore), 0);
}

/**
 * Build the globe snapshot server-side from the full accepted-event set. Marker
 * placement + level assignment happen inside buildGlobeActivitySnapshot.
 */
export function composeGlobeSnapshot(
  events: readonly IntelligenceEventCandidate[],
  state: "fresh" | "partial",
  now = Date.now(),
): GlobeActivitySnapshot {
  const allMarkers = sourceItemsToMarkers([...events]);
  const markers =
    allMarkers.length > MAX_GLOBE_MARKERS
      ? [...allMarkers]
          .sort((a, b) => markerScore(b) - markerScore(a))
          .slice(0, MAX_GLOBE_MARKERS)
      : allMarkers;

  return buildGlobeActivitySnapshot({
    items: [...events],
    markers,
    loadState: state === "fresh" ? "loaded" : "partial",
    sourceMode: "scheduled_collector",
    now,
  });
}

// The globe snapshot carries a "state" for the globe's own load contract; the
// derived-payload store needs a narrowed fresh/partial flag + non-null
// generatedAt for slot bookkeeping.
type StorableGlobeSnapshot = Omit<
  GlobeActivitySnapshot,
  "state" | "generatedAt"
> & {
  schemaVersion: number;
  generatedAt: string;
  state: "fresh" | "partial";
};

export async function storeGlobeSnapshot(
  pool: Pool,
  events: readonly IntelligenceEventCandidate[],
  state: "fresh" | "partial",
  buildId = "dev",
): Promise<GlobeActivitySnapshot> {
  const snapshot = composeGlobeSnapshot(events, state);
  const storable: StorableGlobeSnapshot = {
    ...snapshot,
    generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
    // Store bookkeeping state: only fresh/partial (stale is a read-time verdict).
    state: snapshot.state === "fresh" ? "fresh" : "partial",
  };
  await storeDerivedPayload(pool, "globe", storable, buildId);
  log("info", "globe_snapshot_built", {
    state: snapshot.state,
    points: snapshot.points.length,
    totalItems: snapshot.totalItemCount,
    geolocated: snapshot.geolocatedItemCount,
  });
  return snapshot;
}

export type StoredGlobeSnapshot = StoredDerivedPayload<GlobeActivitySnapshot>;

export async function readGlobeSnapshot(
  pool: Pool,
): Promise<StoredGlobeSnapshot | null> {
  return readDerivedPayload<GlobeActivitySnapshot>(pool, "globe");
}
