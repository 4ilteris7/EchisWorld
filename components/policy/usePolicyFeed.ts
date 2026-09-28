"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PolicyRegionMetric,
  PolicyReportLive,
  PolicyTopicMetric,
} from "@/lib/policy";
import { STATE_AFFILIATED_SOURCE_IDS } from "@/lib/policy/stateAffiliation";
import type { PolicyFeedPayload } from "@/lib/backend/payloads/policyPayload";

// F4B (accepted): this screen consumes ONLY the worker-built ECHIS payload via
// a single GET /api/feeds/policy. It must never fetch upstream RSS again; the
// source list below remains as screen metadata (manifest contract tests), not
// as a fetch plan.

/** RSS sources feeding the Policy Dossier screen (collected by the worker). */
export const POLICY_SOURCE_IDS = [
  "skynews-politics",
  "presstv-politics",
  "mehr-politics",
  "saba-politics",
  "tanjug-politika",
  "gazetauz-politics",
  "aljazeera-middle-east",
  "tass-world",
  "euronews-world",
  "france24-world",
  "un-news",
  "bbc-world",
  "dw-world",
  "crisis-group",
  "foreign-policy",
  "global-times",
  "apa",
  "war-on-the-rocks",
  "the-diplomat",
  "brookings",
  "carnegie-endowment",
  "jamestown-foundation",
  "csis",
  "middle-east-institute",
  "isw",
  "ecfr",
  "besa-center",
  "cfr",
  "chatham-house",
  "rand-corporation",
  "rusi",
  "stimson-center",
  "fpri",
  "wilson-center",
  "modern-diplomacy",
  "eurasia-review",
  "hoover-institution",
  "cnas",
  "intelnews",
  "cipher-brief",
  "long-war-journal",
  "bellingcat",
  "soufan-center",
  "gnet",
  "grey-dynamics",
  "militant-wire",
  "homeland-security-today",
  "counter-extremism-project",
  "clearancejobs-defense-intel",
  "spytalk",
  "global-security",
  "al-monitor",
  "middle-east-eye",
  "the-national-uae",
  "scmp-diplomacy",
  "nikkei-asia-politics",
  "moscow-times",
  "rferl",
  "voa-world",
  "radio-free-asia",
  "eurasianet",
  "geopolitical-monitor",
  "meduza-en",
  "novaya-gazeta-europe-en",
  "kyiv-independent",
] as const;

// Canonical set lives in lib/policy/stateAffiliation.ts (shared with the
// worker-side payload builder); re-exported here for existing importers.
export { STATE_AFFILIATED_SOURCE_IDS };

export type PolicyFeedFreshness = "fresh" | "partial" | "stale";

export interface PolicyFeedState {
  items: PolicyReportLive[];
  topics: PolicyTopicMetric[];
  regions: PolicyRegionMetric[];
  isLoading: boolean;
  error: string | null;
  relevantItems: number;
  totalItems: number;
  /** Backend payload state; null while unavailable. */
  feedState: PolicyFeedFreshness | null;
}

/** Recompute the freshness bucket at render time from the publish timestamp. */
function withFreshMinsAgo(item: PolicyReportLive): PolicyReportLive {
  if (!item.publishedAt) return item;
  const timestamp = new Date(item.publishedAt).getTime();
  if (Number.isNaN(timestamp)) return item;
  return {
    ...item,
    minsAgo: Math.max(0, Math.floor((Date.now() - timestamp) / 60000)),
  };
}

// ── Module-level feed cache ─────────────────────────────────────────────────
// The Policy screen unmounts on every tab switch. Keeping the fetched feed in
// module scope means returning to the tab renders instantly from memory and
// only refreshes in the background once the snapshot is stale.

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

type FeedAnalysis = {
  items: PolicyReportLive[];
  topics: PolicyTopicMetric[];
  regions: PolicyRegionMetric[];
  relevantItems: number;
  totalItems: number;
};

type FeedSnapshot = {
  analysis: FeedAnalysis;
  error: string | null;
  feedState: PolicyFeedFreshness | null;
};

let feedCache: FeedSnapshot | null = null;
let feedCacheAt = 0;
let feedInFlight: Promise<FeedSnapshot> | null = null;

const EMPTY_ANALYSIS: FeedAnalysis = {
  items: [],
  topics: [],
  regions: [],
  relevantItems: 0,
  totalItems: 0,
};

type ServedPolicyPayload = Omit<PolicyFeedPayload, "state"> & {
  state: PolicyFeedFreshness | "unavailable";
  ageSeconds?: number;
};

async function fetchDerivedFeed(): Promise<FeedSnapshot> {
  const response = await fetch("/api/feeds/policy", { cache: "no-store" });

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

  const payload = (await response.json()) as ServedPolicyPayload;
  const analysis = payload.analysis ?? EMPTY_ANALYSIS;
  return {
    analysis: {
      items: analysis.items.map(withFreshMinsAgo),
      topics: analysis.topics,
      regions: analysis.regions,
      relevantItems: analysis.relevantItems,
      totalItems: analysis.totalItems,
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
export function prefetchPolicyFeed(): void {
  void loadFeed().catch(() => {});
}

export function usePolicyFeed(): PolicyFeedState {
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
      topics: analysis.topics,
      regions: analysis.regions,
      isLoading,
      error: snapshot?.error ?? null,
      relevantItems: analysis.relevantItems,
      totalItems: analysis.totalItems,
      feedState: snapshot?.feedState ?? null,
    };
  }, [snapshot, isLoading]);
}
