"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DefenseFeedItemLive,
  DefenseSegmentMetric,
  DefenseSupplyChainMetric,
} from "@/lib/defense";
import type { DefenseFeedPayload } from "@/lib/backend/payloads/defensePayload";

// F4A (accepted): this screen consumes ONLY the worker-built ECHIS payload via
// a single GET /api/feeds/defense. It must never fetch upstream RSS again; the
// source list below remains as screen metadata (manifest contract tests), not
// as a fetch plan.

/** RSS sources feeding the Defense Industry screen (collected by the worker). */
export const DEFENSE_SOURCE_IDS = [
  "breaking-defense",
  "defensenews-all",
  "the-war-zone",
  "the-aviationist",
  "defense-one",
  "naval-news",
  "edr-magazine",
  "usni-news",
  "dsca-fms",
  "defensescoop",
  "airspace-forces",
  "defence-industry-eu",
  "defence-blog",
  "savunmatr",
  "c4isrnet",
  "overt-defense",
  "uk-defence-journal",
  "shephard-media",
  "army-technology",
  "naval-technology",
  "airforce-technology",
  "defense-update",
  "sofrep",
  "military-times",
  "army-times",
  "navy-times",
  "air-force-times",
  "marine-corps-times",
  "national-defense-magazine",
  "asian-military-review",
  "european-security-defence",
  "defence-connect",
] as const;

export type DefenseFeedFreshness = "fresh" | "partial" | "stale";

export interface DefenseIndustryFeedState {
  items: DefenseFeedItemLive[];
  segments: DefenseSegmentMetric[];
  supplyChain: DefenseSupplyChainMetric[];
  isLoading: boolean;
  error: string | null;
  relevantItems: number;
  totalItems: number;
  /** Backend payload state; null while unavailable. */
  feedState: DefenseFeedFreshness | null;
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "RSS item";

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

// ── Module-level feed cache ─────────────────────────────────────────────────
// The Defense Industry screen unmounts on every tab switch. Keeping the fetched
// feed in module scope means returning to the tab renders instantly from memory
// and only refreshes in the background once the snapshot is stale.

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

type FeedSnapshot = {
  analysis: {
    items: DefenseFeedItemLive[];
    segments: DefenseSegmentMetric[];
    supplyChain: DefenseSupplyChainMetric[];
    relevantItems: number;
    totalItems: number;
  };
  error: string | null;
  feedState: DefenseFeedFreshness | null;
};

let feedCache: FeedSnapshot | null = null;
let feedCacheAt = 0;
let feedInFlight: Promise<FeedSnapshot> | null = null;

const EMPTY_ANALYSIS: FeedSnapshot["analysis"] = {
  items: [],
  segments: [],
  supplyChain: [],
  relevantItems: 0,
  totalItems: 0,
};

type ServedDefensePayload = Omit<DefenseFeedPayload, "state"> & {
  state: DefenseFeedFreshness | "unavailable";
  ageSeconds?: number;
};

async function fetchDerivedFeed(): Promise<FeedSnapshot> {
  const response = await fetch("/api/feeds/defense", { cache: "no-store" });

  if (response.status === 503) {
    return { analysis: EMPTY_ANALYSIS, error: "feed_unavailable", feedState: null };
  }
  if (!response.ok) {
    return {
      analysis: EMPTY_ANALYSIS,
      error: `feed_${response.status}`,
      feedState: null,
    };
  }

  const payload = (await response.json()) as ServedDefensePayload;
  const analysis = payload.analysis ?? EMPTY_ANALYSIS;
  return {
    analysis: {
      ...analysis,
      // "x min ago" labels are recomputed at render time so a payload built
      // minutes earlier doesn't show frozen timestamps.
      items: analysis.items.map((item) =>
        item.publishedAt
          ? { ...item, timeAgo: formatRelativeTime(item.publishedAt) }
          : item,
      ),
    },
    error: null,
    feedState: payload.state === "unavailable" ? null : payload.state,
  };
}

function loadFeed(): Promise<FeedSnapshot> {
  if (feedCache && !feedCache.error && Date.now() - feedCacheAt < FEED_CACHE_TTL_MS) {
    return Promise.resolve(feedCache);
  }
  if (feedInFlight) return feedInFlight;

  feedInFlight = fetchDerivedFeed()
    .then((snapshot) => {
      if (!snapshot.error) {
        feedCache = snapshot;
        feedCacheAt = Date.now();
        return snapshot;
      }
      // Feed failed: keep serving the last good snapshot if we have one.
      return feedCache ?? snapshot;
    })
    .catch(
      () =>
        feedCache ?? {
          analysis: EMPTY_ANALYSIS,
          error: "feed_fetch_failed",
          feedState: null,
        },
    )
    .finally(() => {
      feedInFlight = null;
    });
  return feedInFlight;
}

/** Warm the feed cache without mounting the screen (called once at app open). */
export function prefetchDefenseIndustryFeed(): void {
  void loadFeed().catch(() => {});
}

export function useDefenseIndustryFeed(): DefenseIndustryFeedState {
  // Any cached snapshot (even stale) renders immediately; a stale one is
  // refreshed in the background by the effect below.
  const [snapshot, setSnapshot] = useState<FeedSnapshot | null>(feedCache);
  const [isLoading, setIsLoading] = useState(feedCache === null);

  useEffect(() => {
    let cancelled = false;

    loadFeed().then((next) => {
      if (cancelled) return;
      setSnapshot(next);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const analysis = snapshot?.analysis ?? EMPTY_ANALYSIS;
    return {
      items: analysis.items,
      segments: analysis.segments,
      supplyChain: analysis.supplyChain,
      isLoading,
      error: snapshot?.error ?? null,
      relevantItems: analysis.relevantItems,
      totalItems: analysis.totalItems,
      feedState: snapshot?.feedState ?? null,
    };
  }, [snapshot, isLoading]);
}
