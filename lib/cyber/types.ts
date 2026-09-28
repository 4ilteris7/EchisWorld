// ---------------------------------------------------------------------------
// Cyber signal analysis — public types.
//
// These types describe the metrics derived from live RSS Cyber News items
// (title + summary text) for the "Most Mentioned Regions" and
// "Affected Sectors" panels.
//
// Everything produced here is INFERRED from open-source RSS text. It is a
// heuristic, language-model-free signal — not a verified attribution. The
// `provenance` flag on the result makes that explicit so the UI never presents
// these numbers as ground truth.
// ---------------------------------------------------------------------------

/**
 * Macro-region taxonomy. Countries roll up into exactly one macro-region so
 * the panel stays readable; the contributing countries are kept on the metric
 * for drill-down / tooltips.
 */
export type RegionId =
  | "north_america"
  | "latin_america"
  | "europe"
  | "russia_cis"
  | "middle_east"
  | "africa"
  | "south_asia"
  | "east_asia"
  | "southeast_asia"
  | "central_asia"
  | "oceania"
  | "global";

/**
 * Role a region/country plays in a single news item.
 *  - target  : the victim / affected party ("… target Taiwan")
 *  - origin  : the attacker / threat-actor home ("Chinese hackers …")
 *  - neutral : mentioned with no clear attacker/victim role
 */
export type GeoRole = "target" | "origin" | "neutral";

export type SectorId =
  | "finance_crypto"
  | "healthcare"
  | "government"
  | "defense_military"
  | "cloud_identity"
  | "software_supply_chain"
  | "industrial_ot"
  | "enterprise_infra"
  | "telecom"
  | "energy_utilities"
  | "retail_ecommerce"
  | "education_research"
  | "media_entertainment"
  | "transportation_logistics"
  | "technology";

/** Confidence band for an inferred signal. */
export type SignalConfidence = "high" | "medium" | "low";

/** A single country detected inside one item, with its inferred role. */
export interface CountryHit {
  /** Canonical country name (e.g. "Taiwan"). */
  country: string;
  regionId: RegionId;
  roles: GeoRole[];
  /** Strongest role for sorting/labelling. */
  primaryRole: GeoRole;
  confidence: SignalConfidence;
  /** The textual evidence that triggered the hit (normalized). */
  evidence: string;
}

/** A threat actor detected inside one item. */
export interface ActorHit {
  name: string;
  /** Country the actor is publicly attributed to, if any. */
  attributedCountry?: string;
  attributedRegionId?: RegionId;
  kind: "nation_state" | "cybercrime" | "hacktivist" | "unspecified";
  evidence: string;
}

/** A sector detected inside one item, with the score that produced it. */
export interface SectorHit {
  sectorId: SectorId;
  label: string;
  score: number;
  confidence: SignalConfidence;
  matchedTerms: string[];
}

/** Full per-item annotation (kept for tooltips / threat-context reuse). */
export interface ItemAnnotation {
  id: string;
  countries: CountryHit[];
  actors: ActorHit[];
  sectors: SectorHit[];
  /** True when the item produced no region and no sector signal. */
  unresolved: boolean;
}

export interface RegionMetric {
  regionId: RegionId;
  label: string;
  /** Number of items that referenced this region (deduplicated per item). */
  itemCount: number;
  /** itemCount / totalItems, 0..1. */
  share: number;
  /** How many items had this region in each role (an item can count twice). */
  roleBreakdown: Record<GeoRole, number>;
  /** Role shown as the region's headline tag. */
  dominantRole: GeoRole;
  /** Up to a few canonical country names that fed this region. */
  sampleCountries: string[];
}

export interface SectorMetric {
  sectorId: SectorId;
  label: string;
  /** Number of items mapped to this sector. */
  itemCount: number;
  /** itemCount / totalItems, 0..1 (the "% of feed" basis from the spec). */
  share: number;
  /** Representative matched keywords, for tooltip/debug. */
  sampleTerms: string[];
}

export interface CyberSignalResult {
  /** Total live RSS items considered. */
  totalItems: number;
  /** Items that produced at least one region OR sector signal. */
  analyzedItems: number;
  /** Items with no geographic signal (the "Global / Unspecified" bucket). */
  unspecifiedRegionItems: number;
  regions: RegionMetric[];
  sectors: SectorMetric[];
  /** Per-item detail; omitted when `includeAnnotations` is false. */
  annotations?: ItemAnnotation[];
  /** Provenance — these numbers are inferred from RSS text only. */
  provenance: "derived_from_rss_text";
  inferred: true;
}

/** Minimal item shape the engine needs — decoupled from NormalizedSourceItem. */
export interface CyberSignalInput {
  id?: string;
  title: string;
  summary?: string;
}

export interface AnalyzeOptions {
  /** Include per-item annotations in the result (default false). */
  includeAnnotations?: boolean;
  /** Max region rows returned (default: all, sorted desc). */
  maxRegions?: number;
  /** Max sector rows returned (default: all, sorted desc). */
  maxSectors?: number;
}
