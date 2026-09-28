// Source foundation types.
// These types are intentionally generic so future adapters (RSS, API, static,
// GDELT, CISA KEV, NVD, GDACS, ReliefWeb, etc.) can share the same shape.

export type SourceAccessType = "rss" | "api" | "static" | "manual";

export type SourceCandidateStatus =
  | "candidate_test"
  | "review_more"
  | "later"
  | "rejected";

export type SourceStatus =
  | "public_news_source"
  | "established_media"
  | "official_government"
  | "official_feed"
  | "community_signal"
  | "reference_dataset";

export type VerificationStatus =
  | "source_reported"
  | "official_entry"
  | "official_statement"
  | "multi_source_reference"
  | "manual_sample";

export type SourceBasis =
  | "single_public_source"
  | "single_official_source"
  | "official_source"
  | "multiple_public_sources"
  | "manual_sample";

export type ExtractionMethod =
  | "rss_summary"
  | "rss_feed"
  | "official_json"
  | "manual_sample"
  | "keyword_match"
  | "api_result";

export type SourceRegionScope =
  | "global"
  | "north_america"
  | "middle_east"
  | "europe"
  | "asia_pacific"
  | "americas"
  | "africa";

export type SourceTargetScreen =
  | "monitor"
  | "intel_watch"
  | "cyber_news"
  | "defense_industry"
  | "policy"
  | "sources";

export type SourceLanguage =
  | "tr"
  | "en"
  | "ar"
  | "fr"
  | "es"
  | "ru"
  | "de"
  | "sr"  // Serbian (Tanjug)
  | "el"  // Greek (ERT News)
  | "az"  // Azerbaijani
  | "zh"  // Chinese
  | "vi"; // Vietnamese

/**
 * Thematic profile of a source.
 * Supports downstream classification and marker-placement strategy.
 */
export type SourceProfile =
  | "general_news"
  | "official_diplomatic"
  | "conflict_crisis";

/**
 * How source items are placed on the globe as markers.
 *  item_location   - deterministic location matching from item text (default)
 *  source_location - fixed coordinates from sourceLocation (official sources)
 */
export type MarkerLocationStrategy = "item_location" | "source_location";

/**
 * Fixed geographic anchor for official/institutional sources.
 * Used when markerLocationStrategy === "source_location".
 */
export type SourceLocation = {
  /** Human-readable label shown in the marker popup. */
  label: string;
  country: string;
  lat: number;
  lng: number;
};

export type SourceDefinition = {
  id: string;
  name: string;
  category: string;
  accessType: SourceAccessType;
  candidateStatus: SourceCandidateStatus;
  sourceStatus: SourceStatus;
  verificationStatus: VerificationStatus;
  sourceBasis: SourceBasis;
  extractionMethod: ExtractionMethod;
  baseUrl: string;
  candidateFeedUrl?: string;
  language: SourceLanguage;
  regionScope: SourceRegionScope;
  targetScreens: SourceTargetScreen[];
  notes?: string;
  /** Thematic profile for downstream classification and marker behavior. */
  sourceProfile?: SourceProfile;
  /** How items from this source generate globe markers. */
  markerLocationStrategy?: MarkerLocationStrategy;
  /** Fixed anchor coordinates; required when markerLocationStrategy === "source_location". */
  sourceLocation?: SourceLocation;
};

export type NormalizedSourceItem = {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  collectedAt: string;
  sourceType: SourceAccessType;
  sourceStatus: SourceStatus;
  verificationStatus: VerificationStatus;
  sourceBasis: SourceBasis;
  extractionMethod: ExtractionMethod;
  sourceLanguage?: SourceLanguage;
  relatedCountries: string[];
  relatedRegions: SourceRegionScope[];
  category: string;
  isSample: boolean;
  /** Copied from SourceDefinition at parse time for downstream classification. */
  sourceProfile?: SourceProfile;
  /** Copied from SourceDefinition at parse time; drives marker placement. */
  markerLocationStrategy?: MarkerLocationStrategy;
  /**
   * Pre-computed marker anchor for source_location sources.
   * Undefined for item_location sources (location matched from item text).
   */
  sourceLocationForMarker?: { lat: number; lng: number; locationName: string };
};
