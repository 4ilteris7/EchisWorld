"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSourceIntelligenceStore } from "./SourceIntelligenceProvider";

// ---------------------------------------------------------------------------
// Global View auto-refresh.
//
// Non-invasive: it only calls the store's already-exposed `previewSource`, which
// re-fetches a source and merges/prunes results through the existing pipeline
// (new items enqueued, removed items pruned, dedup by stable key). It never
// touches pipeline internals.
//
// Behaviour:
//   • Refreshes every `intervalMs` while the tab is visible.
//   • Skips a tick if the pipeline is still busy (avoids piling up work).
//   • On returning to a visible tab after being hidden past one interval, it
//     refreshes once immediately.
//   • Because the Global View feed is conditionally mounted, this hook's timers
//     live only while Global View is on screen.
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 120_000;

export interface SourceFeedAutoRefresh {
  /** Trigger an immediate refresh of every active source. */
  refreshNow: () => void;
  /** ISO timestamp of the last refresh this hook initiated (or null). */
  lastRefreshAt: string | null;
  /** True while a hook-initiated refresh cycle is dispatching. */
  isRefreshing: boolean;
}

export function useSourceFeedAutoRefresh(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): SourceFeedAutoRefresh {
  const store = useSourceIntelligenceStore();
  const { sources, previewSource, pipelineBusy } = store;

  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keep latest values in refs so the interval closure stays stable. Refs are
  // synced in an effect (not during render) per the react-hooks rules.
  const sourcesRef = useRef(sources);
  const previewRef = useRef(previewSource);
  const busyRef = useRef(pipelineBusy);
  useEffect(() => {
    sourcesRef.current = sources;
    previewRef.current = previewSource;
    busyRef.current = pipelineBusy;
  });

  const runRefresh = useCallback((force = false) => {
    if (!force && busyRef.current) return;
    const list = sourcesRef.current;
    if (!list || list.length === 0) return;

    setIsRefreshing(true);
    setLastRefreshAt(new Date().toISOString());
    // Fire all source refreshes; the provider already handles concurrency,
    // dedup and pruning. Clear the visual flag shortly after dispatch.
    for (const source of list) {
      void previewRef.current(source.id);
    }
    window.setTimeout(() => setIsRefreshing(false), 600);
  }, []);

  const refreshNow = useCallback(() => runRefresh(true), [runRefresh]);

  useEffect(() => {
    let lastTick = Date.now();

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      lastTick = Date.now();
      runRefresh(false);
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Returned to the tab after being away longer than one interval → refresh.
      if (Date.now() - lastTick >= intervalMs) {
        lastTick = Date.now();
        runRefresh(false);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, runRefresh]);

  return { refreshNow, lastRefreshAt, isRefreshing };
}
