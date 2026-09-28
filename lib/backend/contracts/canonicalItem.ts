// Canonical collected-item contract (F0C).
//
// The project currently carries two separate `NormalizedSourceItem` types:
//   A) data/sources/sourceTypes.ts            (screen feeds: cyber/defense/policy)
//   B) data/source-intelligence/sourceIntelligenceTypes.ts (global pipeline)
//
// This module defines the single canonical item DTO that the backend
// (collector, PostgreSQL `collected_items`, read-only API) will use, plus
// lossless-enough mappings from both legacy shapes. Per roadmap §6.2 the
// canonical item stores title/summary/link metadata only — never full article
// bodies or raw XML.
//
// Server-only. Client components keep consuming their existing types until
// each screen is migrated (Faz 3+).

import { createHash } from "crypto";
import type { NormalizedSourceItem as LegacyScreenItem } from "@/data/sources/sourceTypes";
import type { NormalizedSourceItem as LegacyIntelItem } from "@/data/source-intelligence/sourceIntelligenceTypes";

export type CanonicalVerificationStatus =
  | "official"
  | "reported"
  | "multi_source"
  | "needs_review"
  | "sample";

export type CanonicalSourceBasis =
  | "official_source"
  | "single_public_source"
  | "multiple_public_sources"
  | "dataset_record"
  | "sample";

export type CanonicalExtractionMethod =
  | "rss_summary"
  | "api_payload"
  | "official_json"
  | "scraped_page"
  | "script_import"
  | "keyword_match"
  | "sample";

/**
 * Canonical collected item — the persistence contract for `collected_items`.
 * Times are ISO-8601 UTC strings. `publishedAt` is upstream-provided and may
 * be absent or unreliable; `collectedAt` is always set by our collector.
 */
export type CanonicalSourceItem = {
  sourceId: string;
  /** Upstream GUID/id when the feed provides one. */
  upstreamItemId?: string;
  /** Original item URL as received (http(s) only). */
  url?: string;
  /** Normalized URL used for dedupe (tracking params and fragments removed). */
  canonicalUrl?: string;
  /** Stable dedupe hash over source + normalized title + published time. */
  fingerprint: string;
  title: string;
  summary?: string;
  language?: string;
  publishedAt?: string;
  collectedAt: string;
  verification: CanonicalVerificationStatus;
  basis: CanonicalSourceBasis;
  extraction: CanonicalExtractionMethod;
  /** Bounded, schema-variable extras (JSONB column). Never full content. */
  metadata?: Record<string, unknown>;
};

// ── URL canonicalization ────────────────────────────────────────────────────

const TRACKING_PARAM_PATTERN =
  /^(?:utm_\w+|fbclid|gclid|yclid|mc_cid|mc_eid|ref|cmpid|ncid|ico)$/i;

/**
 * Normalize an item URL for dedupe: https/http only, lowercase scheme+host,
 * drop fragments and tracking params, trim trailing slash (except root).
 * Returns undefined for anything that is not a well-formed http(s) URL.
 */
export function canonicalizeUrl(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  url.hash = "";
  const keep: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!TRACKING_PARAM_PATTERN.test(key)) keep.push([key, value]);
  }
  url.search = "";
  for (const [key, value] of keep) url.searchParams.append(key, value);

  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }
  url.pathname = pathname;

  return url.toString();
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

function normalizeTitleForFingerprint(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Deterministic dedupe key per roadmap §6.2 tier 3:
 * source + normalized title + upstream publish time.
 */
export function computeItemFingerprint(
  sourceId: string,
  title: string,
  publishedAt?: string,
): string {
  const input = `${sourceId}\n${normalizeTitleForFingerprint(title)}\n${publishedAt ?? ""}`;
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ── Legacy vocabulary mappings ──────────────────────────────────────────────

const SCREEN_VERIFICATION_MAP: Record<
  LegacyScreenItem["verificationStatus"],
  CanonicalVerificationStatus
> = {
  source_reported: "reported",
  official_entry: "official",
  official_statement: "official",
  multi_source_reference: "multi_source",
  manual_sample: "sample",
};

const SCREEN_BASIS_MAP: Record<
  LegacyScreenItem["sourceBasis"],
  CanonicalSourceBasis
> = {
  single_public_source: "single_public_source",
  single_official_source: "official_source",
  official_source: "official_source",
  multiple_public_sources: "multiple_public_sources",
  manual_sample: "sample",
};

const SCREEN_EXTRACTION_MAP: Record<
  LegacyScreenItem["extractionMethod"],
  CanonicalExtractionMethod
> = {
  rss_summary: "rss_summary",
  rss_feed: "rss_summary",
  official_json: "official_json",
  manual_sample: "sample",
  keyword_match: "keyword_match",
  api_result: "api_payload",
};

const INTEL_VERIFICATION_MAP: Record<
  NonNullable<LegacyIntelItem["verificationStatus"]>,
  CanonicalVerificationStatus
> = {
  official: "official",
  reported: "reported",
  cross_source_matched: "multi_source",
  needs_review: "needs_review",
};

const INTEL_BASIS_MAP: Record<
  NonNullable<LegacyIntelItem["sourceBasis"]>,
  CanonicalSourceBasis
> = {
  official_source: "official_source",
  source_reported: "single_public_source",
  multi_source: "multiple_public_sources",
  single_public_source: "single_public_source",
  scraped_candidate: "single_public_source",
  dataset_record: "dataset_record",
};

const INTEL_EXTRACTION_MAP: Record<
  NonNullable<LegacyIntelItem["extractionMethod"]>,
  CanonicalExtractionMethod
> = {
  rss_summary: "rss_summary",
  api_payload: "api_payload",
  scraped_page: "scraped_page",
  dataset_record: "api_payload",
  script_import: "script_import",
};

// ── Mapping functions ───────────────────────────────────────────────────────

/**
 * Extract the upstream GUID from a legacy composite id of the form
 * `${sourceId}::identifier`. Index-based fallback ids yield undefined.
 */
export function extractUpstreamItemId(
  compositeId: string,
  sourceId: string,
): string | undefined {
  const prefix = `${sourceId}::`;
  if (!compositeId.startsWith(prefix)) return undefined;
  const rest = compositeId.slice(prefix.length);
  // Fallback ids look like `${index}::${timestamp}` — not upstream identity.
  if (/^\d+::/.test(rest)) return undefined;
  return rest || undefined;
}

/** Map a screen-feed item (data/sources) onto the canonical contract. */
export function canonicalItemFromScreenItem(
  item: LegacyScreenItem,
): CanonicalSourceItem {
  return {
    sourceId: item.sourceId,
    upstreamItemId: extractUpstreamItemId(item.id, item.sourceId),
    url: item.url || undefined,
    canonicalUrl: canonicalizeUrl(item.url),
    fingerprint: computeItemFingerprint(
      item.sourceId,
      item.title,
      item.publishedAt || undefined,
    ),
    title: item.title,
    summary: item.summary || undefined,
    language: item.sourceLanguage,
    publishedAt: item.publishedAt || undefined,
    collectedAt: item.collectedAt,
    verification: SCREEN_VERIFICATION_MAP[item.verificationStatus],
    basis: SCREEN_BASIS_MAP[item.sourceBasis],
    extraction: SCREEN_EXTRACTION_MAP[item.extractionMethod],
    metadata: {
      category: item.category,
      relatedRegions: item.relatedRegions,
      // Bounded country hints from API adapters; the intel geo engine uses
      // them as mentioned/actor country context (§ Faz 5 parity).
      ...(item.relatedCountries.length > 0
        ? { relatedCountries: item.relatedCountries.slice(0, 12) }
        : {}),
    },
  };
}

/** Map a global-pipeline item (data/source-intelligence) onto the contract. */
export function canonicalItemFromIntelligenceItem(
  item: LegacyIntelItem,
  collectedAtFallback: string = new Date().toISOString(),
): CanonicalSourceItem {
  return {
    sourceId: item.sourceId,
    upstreamItemId: extractUpstreamItemId(item.id, item.sourceId),
    url: item.url,
    canonicalUrl: canonicalizeUrl(item.url),
    fingerprint: computeItemFingerprint(
      item.sourceId,
      item.title,
      item.publishedAt,
    ),
    title: item.title,
    summary: item.summary,
    language: item.language,
    publishedAt: item.publishedAt,
    collectedAt: item.collectedAt ?? collectedAtFallback,
    verification: item.verificationStatus
      ? INTEL_VERIFICATION_MAP[item.verificationStatus]
      : "reported",
    basis: item.sourceBasis
      ? INTEL_BASIS_MAP[item.sourceBasis]
      : "single_public_source",
    extraction: item.extractionMethod
      ? INTEL_EXTRACTION_MAP[item.extractionMethod]
      : "rss_summary",
    metadata: {
      sourceType: item.sourceType,
      collectionMethod: item.collectionMethod,
    },
  };
}
