"use client";

import { useEffect, useState } from "react";
import {
  GLOBE_ACTIVITY_SNAPSHOT_VERSION,
  type GlobeActivitySnapshot,
} from "@/types/globe-activity";

// F6A client switch: the welcome globe reads the worker-built snapshot from
// /api/globe/snapshot instead of recomputing buildGlobeActivitySnapshot in the
// browser. Same shape, same look — the snapshot is just fetched ready-made.

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

function fallbackSnapshot(
  state: GlobeActivitySnapshot["state"],
): GlobeActivitySnapshot {
  return {
    schemaVersion: GLOBE_ACTIVITY_SNAPSHOT_VERSION,
    sourceMode: "scheduled_collector",
    state,
    generatedAt: null,
    expiresAt: null,
    windowHours: 24,
    totalItemCount: 0,
    geolocatedItemCount: 0,
    points: [],
  };
}

// Module-level cache so tab switches render the last snapshot instantly.
let snapshotCache: GlobeActivitySnapshot | null = null;
let inFlight: Promise<GlobeActivitySnapshot> | null = null;

async function fetchSnapshot(): Promise<GlobeActivitySnapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/globe/snapshot", { cache: "no-store" });
      if (res.status === 503) {
        snapshotCache = snapshotCache ? { ...snapshotCache, state: "stale" } : null;
        return snapshotCache ?? fallbackSnapshot("unavailable");
      }
      if (!res.ok) {
        snapshotCache = snapshotCache ? { ...snapshotCache, state: "stale" } : null;
        return snapshotCache ?? fallbackSnapshot("unavailable");
      }
      const snapshot = (await res.json()) as GlobeActivitySnapshot;
      snapshotCache = snapshot;
      return snapshot;
    } catch {
      snapshotCache = snapshotCache ? { ...snapshotCache, state: "stale" } : null;
      return snapshotCache ?? fallbackSnapshot("unavailable");
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useGlobeSnapshot(): GlobeActivitySnapshot {
  const [snapshot, setSnapshot] = useState<GlobeActivitySnapshot>(
    snapshotCache ?? fallbackSnapshot("loading"),
  );

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      void fetchSnapshot().then((next) => {
        if (!cancelled) setSnapshot(next);
      });
    };

    load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return snapshot;
}
