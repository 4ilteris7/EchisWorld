"use client";

import { useEffect, useMemo, useState } from "react";
import type { CyberNewsItem } from "@/types/cyberNews";
import type { CyberSignalResult } from "@/lib/cyber";
import type {
  CyberFeedPayload,
  CyberFeedPayloadItem,
} from "@/lib/backend/payloads/cyberPayload";

// F3B (accepted): this screen consumes ONLY the worker-built ECHIS payload via
// a single GET /api/feeds/cyber. It must never fetch upstream RSS again; the
// source list below remains as screen metadata (labels, manifest contract
// tests), not as a fetch plan.

/** RSS sources feeding the Cyber News screen (collected by the backend worker). */
export const CYBER_NEWS_SOURCE_IDS = [
  "the-hacker-news",
  "bleeping-computer",
  "the-record",
  "dark-reading",
  "cyberscoop",
  "securityweek",
  "cisa-news",
  "talos",
  "unit42",
  "krebs-security",
  "helpnet-security",
  "infosecurity-mag",
  "register-security",
  "welivesecurity",
  "malwarebytes",
  "securelist",
  "ncsc-uk",
  "schneier",
  "security-affairs",
  "cyber-defense-magazine",
  "naked-security",
  "sans-isc",
  "graham-cluley",
  "darknet",
  "cso-online",
  "hackernoon-cybersecurity",
  "cyberwire",
  "security-boulevard",
  "mandiant-threat-intel",
  "sentinelone-blog",
  "trendmicro-security-intelligence",
  "tripwire-state-of-security",
  "cyber-daily-au",
  "threatmon",
  "red-canary",
] as const;

/** Human-readable source label for the map info strip. */
export const CYBER_NEWS_SOURCE_LABEL =
  "The Hacker News · BleepingComputer · The Record · Dark Reading · CyberScoop · Talos · Unit 42 · Krebs · SecurityWeek · CISA + more";

export type CyberFeedFreshness = "fresh" | "partial" | "stale";

type CyberNewsFeedState = {
  items: CyberNewsItem[];
  isLoading: boolean;
  error: string | null;
  collectedAt: string | null;
  /** Backend payload state (fresh/partial/stale); null while unavailable. */
  feedState: CyberFeedFreshness | null;
  /** Server-computed region/sector/annotation signals. */
  analysis: CyberSignalResult | null;
};

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

function formatContextTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "RSS item";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Map one worker-payload item onto the shape the panels render. */
function payloadItemToCyberNewsItem(item: CyberFeedPayloadItem): CyberNewsItem {
  const publishedAt = item.publishedAt || item.collectedAt;
  const summary =
    item.summary || "The source RSS item did not include a summary.";

  return {
    id: item.id,
    headline: item.title,
    source: item.sourceName || "RSS Source",
    timeAgo: formatRelativeTime(publishedAt),
    summary,
    categoryTag: item.category || "Cyber Security",
    url: item.url ?? "",
    publishedAt,
    isLive: true,
    // Fallback values only — the Threat Context panel overrides country /
    // sector / actor with the per-item engine annotations when they exist.
    context: {
      country: "Global",
      hackIncident: item.title,
      targetSector: item.category || "Cyber Security",
      contextSummary: summary,
      firstSeen: formatContextTime(publishedAt),
      lastUpdate: formatContextTime(item.collectedAt || publishedAt),
    },
  };
}

// ── Module-level feed cache ─────────────────────────────────────────────────
// The Cyber News screen unmounts on every tab switch. Keeping the fetched feed
// in module scope means returning to the tab renders instantly from memory and
// only refreshes in the background once the snapshot is stale.

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

type FeedSnapshot = {
  cyberItems: CyberNewsItem[];
  error: string | null;
  collectedAt: string | null;
  feedState: CyberFeedFreshness | null;
  analysis: CyberSignalResult | null;
};

let feedCache: FeedSnapshot | null = null;
let feedCacheAt = 0;
let feedInFlight: Promise<FeedSnapshot> | null = null;

type ServedCyberPayload = Omit<CyberFeedPayload, "state"> & {
  /** Read-time state from the API (build state, possibly escalated to stale). */
  state: CyberFeedFreshness | "unavailable";
  ageSeconds?: number;
};

async function fetchDerivedFeed(): Promise<FeedSnapshot> {
  const response = await fetch("/api/feeds/cyber", { cache: "no-store" });

  if (response.status === 503) {
    return {
      cyberItems: [],
      error: "feed_unavailable",
      collectedAt: null,
      feedState: null,
      analysis: null,
    };
  }
  if (!response.ok) {
    return {
      cyberItems: [],
      error: `feed_${response.status}`,
      collectedAt: null,
      feedState: null,
      analysis: null,
    };
  }

  const payload = (await response.json()) as ServedCyberPayload;
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    cyberItems: items.map(payloadItemToCyberNewsItem),
    error: null,
    collectedAt: payload.generatedAt ?? null,
    feedState: payload.state === "unavailable" ? null : payload.state,
    analysis: payload.analysis ?? null,
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
          cyberItems: [],
          error: "feed_fetch_failed",
          collectedAt: null,
          feedState: null,
          analysis: null,
        },
    )
    .finally(() => {
      feedInFlight = null;
    });
  return feedInFlight;
}

/** Warm the feed cache without mounting the screen (called once at app open). */
export function prefetchCyberNewsFeed(): void {
  void loadFeed().catch(() => {});
}

export function useCyberNewsFeed(): CyberNewsFeedState {
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

  return useMemo(
    () => ({
      items: snapshot?.cyberItems ?? [],
      isLoading,
      error: snapshot?.error ?? null,
      collectedAt: snapshot?.collectedAt ?? null,
      feedState: snapshot?.feedState ?? null,
      analysis: snapshot?.analysis ?? null,
    }),
    [snapshot, isLoading],
  );
}
