// Canonical source manifest (F0D).
//
// Single authoritative view over every live ECHIS source. Derived from the
// verified metadata in data/sources/sourceDefinitions.ts and enriched with the
// per-source operational profile required by the backend roadmap
// (docs/ECHIS_UYELIKSIZ_BACKEND_YOL_HARITASI.md §5.4, §8.1).
//
// Rules:
// - Static identity (id, URL, screens, language, trust) lives here, in code,
//   behind code review. Mutable runtime state (next_poll_at, etag, failures)
//   will live in PostgreSQL from Faz 1 on — never here.
// - Screen source lists and the RSS route allowlist must be derived from this
//   manifest, not maintained as parallel literals.
// - Schedule profiles below are bootstrap values only. They are corrected with
//   observed cadence during the F2D pilot before all 137 sources activate.
//
// This module is server-only. Do not import it from client components.

import { candidateSourceDefinitions } from "@/data/sources/sourceDefinitions";
import type {
  SourceDefinition,
  SourceLanguage,
  SourceProfile,
  SourceRegionScope,
  SourceTargetScreen,
} from "@/data/sources/sourceTypes";

export type ManifestCollectionMethod = "rss" | "api" | "aggregator_api";

export type ScheduleMode = "adaptive" | "fixed" | "quota_limited";

/**
 * Bootstrap cadence class per roadmap §8.1. The class only seeds the initial
 * min/base/max window; the adaptive scheduler (F2C) moves the effective
 * interval inside that window from observed publish cadence.
 */
export type CadenceClass =
  | "fast_breaking"
  | "normal_news"
  | "slow_official"
  | "low_change"
  | "quota_api";

export type SourceScheduleProfile = {
  scheduleMode: ScheduleMode;
  cadenceClass: CadenceClass;
  minPollIntervalSeconds: number;
  basePollIntervalSeconds: number;
  maxPollIntervalSeconds: number;
  /**
   * Documented (or conservatively assumed) upstream request budget per day.
   * Machine-readable per roadmap §5.4; the scheduler may consume at most 80%
   * of it. `assumed: true` marks values that MUST be verified against the
   * provider's official policy during the F2D pilot.
   */
  dailyRequestBudget?: { requestsPerDay: number; assumed: boolean };
};

/** Per-source overrides; absent fields fall back to the global safe limits. */
export type SourceLimitOverrides = {
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxItems?: number;
};

export type CanonicalSourceManifestEntry = {
  sourceId: string;
  name: string;
  collectionMethod: ManifestCollectionMethod;
  /** Canonical feed URL (rss) or provider base URL (api). */
  endpoint: string;
  targetScreens: readonly SourceTargetScreen[];
  language: SourceLanguage;
  regionScope: SourceRegionScope;
  sourceProfile?: SourceProfile;
  /**
   * Critical sources drive the fresh/partial state contract (§9.4): an overdue
   * critical source degrades the payload state even when overall coverage is
   * high.
   */
  critical: boolean;
  schedule: SourceScheduleProfile;
  limits?: SourceLimitOverrides;
};

// ── Bootstrap cadence windows (seconds) — roadmap §8.1 table ────────────────

const CADENCE_WINDOWS: Record<
  Exclude<CadenceClass, "quota_api">,
  { min: number; base: number; max: number }
> = {
  fast_breaking: { min: 5 * 60, base: 10 * 60, max: 30 * 60 },
  normal_news: { min: 10 * 60, base: 15 * 60, max: 60 * 60 },
  slow_official: { min: 30 * 60, base: 60 * 60, max: 6 * 60 * 60 },
  low_change: { min: 60 * 60, base: 3 * 60 * 60, max: 12 * 60 * 60 },
};

/**
 * High-tempo wire/breaking feeds allowed to poll down to 5 minutes.
 * Bootstrap-only; membership is re-evaluated from measured cadence in F2D.
 */
const FAST_BREAKING_SOURCE_IDS: ReadonlySet<string> = new Set([
  "aa-en-live",
  "aljazeera-middle-east",
  "skynews-world",
  "euronews-world",
  "tass-world",
  "xinhua-world",
  "bbc-world",
  "france24-world",
  "trt-haber-dunya-feed",
]);

/**
 * Analysis/blog/institutional feeds with a slow publish rhythm.
 * Bootstrap-only; corrected by observed cadence in F2D.
 */
const LOW_CHANGE_SOURCE_IDS: ReadonlySet<string> = new Set([
  "schneier",
  "crisis-group",
  "foreign-policy",
  "african-arguments",
  "insight-crime",
  "globalvoices-main",
  "globalvoices-filtered",
  "dsca-fms",
  "edr-magazine",
  "defence-industry-eu",
]);

/**
 * Critical sources per screen (roadmap §9.4). Kept deliberately small: a
 * single slow low-priority source must not be able to hold the whole system
 * in `partial`.
 */
const CRITICAL_SOURCE_IDS: ReadonlySet<string> = new Set([
  // global / monitor
  "aa-en-live",
  "aljazeera-middle-east",
  "skynews-world",
  // cyber_news
  "the-hacker-news",
  "bleeping-computer",
  "cisa-news",
  // defense_industry
  "defensenews-all",
  "breaking-defense",
  // policy
  "un-news",
  "bbc-world",
]);

/**
 * Documented or assumed API budgets. `assumed: true` values are conservative
 * placeholders that the F2D pilot must replace with the provider's documented
 * policy before the source is scheduled at full tempo.
 */
const API_SCHEDULE_PROFILES: Record<string, SourceScheduleProfile> = {
  "freenews-geopolitical": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 10 * 60,
    basePollIntervalSeconds: 15 * 60,
    maxPollIntervalSeconds: 60 * 60,
    // Documented in source notes: 5000 req/day.
    dailyRequestBudget: { requestsPerDay: 5000, assumed: false },
  },
  "finlight-geopolitical": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 15 * 60,
    basePollIntervalSeconds: 30 * 60,
    maxPollIntervalSeconds: 2 * 60 * 60,
    // Documented in source notes: 5000 req/month ≈ 166/day.
    dailyRequestBudget: { requestsPerDay: 166, assumed: false },
  },
  "newsdata-geopolitical": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 30 * 60,
    basePollIntervalSeconds: 60 * 60,
    maxPollIntervalSeconds: 4 * 60 * 60,
    dailyRequestBudget: { requestsPerDay: 200, assumed: true },
  },
  "currents-geopolitical": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 30 * 60,
    basePollIntervalSeconds: 60 * 60,
    maxPollIntervalSeconds: 4 * 60 * 60,
    dailyRequestBudget: { requestsPerDay: 600, assumed: true },
  },
  "worldnews-geopolitical": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 60 * 60,
    basePollIntervalSeconds: 2 * 60 * 60,
    maxPollIntervalSeconds: 6 * 60 * 60,
    dailyRequestBudget: { requestsPerDay: 100, assumed: true },
  },
  "guardian-world": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 15 * 60,
    basePollIntervalSeconds: 30 * 60,
    maxPollIntervalSeconds: 2 * 60 * 60,
    dailyRequestBudget: { requestsPerDay: 500, assumed: true },
  },
  "gdelt-geopolitical": {
    // Keyless public API; be polite rather than quota-driven.
    scheduleMode: "adaptive",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 15 * 60,
    basePollIntervalSeconds: 30 * 60,
    maxPollIntervalSeconds: 2 * 60 * 60,
  },
  "reliefweb-crises": {
    scheduleMode: "quota_limited",
    cadenceClass: "quota_api",
    minPollIntervalSeconds: 30 * 60,
    basePollIntervalSeconds: 60 * 60,
    maxPollIntervalSeconds: 6 * 60 * 60,
    dailyRequestBudget: { requestsPerDay: 1000, assumed: true },
  },
};

function collectionMethodFor(
  def: SourceDefinition,
): ManifestCollectionMethod {
  if (def.id === "gdelt-geopolitical") return "aggregator_api";
  return def.accessType === "api" ? "api" : "rss";
}

function scheduleFor(
  def: SourceDefinition,
  method: ManifestCollectionMethod,
): SourceScheduleProfile {
  if (method !== "rss") {
    const profile = API_SCHEDULE_PROFILES[def.id];
    if (profile) return profile;
    // Unknown API source: safest bootstrap window until a budget is recorded.
    return {
      scheduleMode: "quota_limited",
      cadenceClass: "quota_api",
      minPollIntervalSeconds: 60 * 60,
      basePollIntervalSeconds: 2 * 60 * 60,
      maxPollIntervalSeconds: 6 * 60 * 60,
      dailyRequestBudget: { requestsPerDay: 50, assumed: true },
    };
  }

  let cadenceClass: Exclude<CadenceClass, "quota_api">;
  if (FAST_BREAKING_SOURCE_IDS.has(def.id)) {
    cadenceClass = "fast_breaking";
  } else if (LOW_CHANGE_SOURCE_IDS.has(def.id)) {
    cadenceClass = "low_change";
  } else if (
    def.sourceStatus === "official_government" ||
    def.sourceStatus === "official_feed"
  ) {
    cadenceClass = "slow_official";
  } else {
    cadenceClass = "normal_news";
  }

  const window = CADENCE_WINDOWS[cadenceClass];
  return {
    scheduleMode: "adaptive",
    cadenceClass,
    minPollIntervalSeconds: window.min,
    basePollIntervalSeconds: window.base,
    maxPollIntervalSeconds: window.max,
  };
}

function endpointFor(
  def: SourceDefinition,
  method: ManifestCollectionMethod,
): string {
  if (method === "rss") return def.candidateFeedUrl ?? "";
  return def.baseUrl;
}

export function buildCanonicalSourceManifest(
  definitions: readonly SourceDefinition[] = candidateSourceDefinitions,
): CanonicalSourceManifestEntry[] {
  const manifest = definitions.map((def): CanonicalSourceManifestEntry => {
    const method = collectionMethodFor(def);
    return {
      sourceId: def.id,
      name: def.name,
      collectionMethod: method,
      endpoint: endpointFor(def, method),
      targetScreens: def.targetScreens,
      language: def.language,
      regionScope: def.regionScope,
      sourceProfile: def.sourceProfile,
      critical: CRITICAL_SOURCE_IDS.has(def.id),
      schedule: scheduleFor(def, method),
    };
  });

  const errors = validateCanonicalSourceManifest(manifest);
  if (errors.length > 0) {
    throw new Error(
      `canonical source manifest invalid:\n${errors.join("\n")}`,
    );
  }
  return manifest;
}

/**
 * Build/test-time validation per roadmap §5.4: a source with min > base,
 * base > max, an invalid URL scheme, or no target screen must be rejected
 * before it can ever reach the scheduler.
 */
export function validateCanonicalSourceManifest(
  manifest: readonly CanonicalSourceManifestEntry[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of manifest) {
    const at = `[${entry.sourceId}]`;

    if (!entry.sourceId) errors.push(`${at} empty sourceId`);
    if (seen.has(entry.sourceId)) errors.push(`${at} duplicate sourceId`);
    seen.add(entry.sourceId);

    if (!entry.endpoint) {
      errors.push(`${at} missing endpoint`);
    } else if (!/^https:\/\//i.test(entry.endpoint)) {
      errors.push(`${at} endpoint must use https: ${entry.endpoint}`);
    }

    if (entry.targetScreens.length === 0) {
      errors.push(`${at} has no target screen`);
    }

    const { minPollIntervalSeconds: min, basePollIntervalSeconds: base, maxPollIntervalSeconds: max } =
      entry.schedule;
    if (min <= 0 || base <= 0 || max <= 0) {
      errors.push(`${at} poll intervals must be positive`);
    }
    if (min > base) errors.push(`${at} min interval exceeds base`);
    if (base > max) errors.push(`${at} base interval exceeds max`);

    const budget = entry.schedule.dailyRequestBudget;
    if (budget && budget.requestsPerDay <= 0) {
      errors.push(`${at} dailyRequestBudget must be positive`);
    }
    if (entry.schedule.scheduleMode === "quota_limited" && !budget) {
      errors.push(`${at} quota_limited source needs a dailyRequestBudget`);
    }
  }

  return errors;
}

// ── Canonical manifest and derived views ────────────────────────────────────

export const CANONICAL_SOURCE_MANIFEST: readonly CanonicalSourceManifestEntry[] =
  buildCanonicalSourceManifest();

const manifestById = new Map(
  CANONICAL_SOURCE_MANIFEST.map((entry) => [entry.sourceId, entry]),
);

export function getManifestEntry(
  sourceId: string,
): CanonicalSourceManifestEntry | undefined {
  return manifestById.get(sourceId);
}

export function manifestSourceIdsForScreen(
  screen: SourceTargetScreen,
): string[] {
  return CANONICAL_SOURCE_MANIFEST.filter((entry) =>
    entry.targetScreens.includes(screen),
  ).map((entry) => entry.sourceId);
}

/**
 * The single authoritative allowlist for the on-demand RSS route: exactly the
 * manifest sources collected over RSS. API sources are served by their own
 * dedicated routes and must never flow through the RSS proxy.
 */
export const RSS_PREVIEW_ALLOWLIST_SOURCE_IDS: ReadonlySet<string> = new Set(
  CANONICAL_SOURCE_MANIFEST.filter(
    (entry) => entry.collectionMethod === "rss",
  ).map((entry) => entry.sourceId),
);
