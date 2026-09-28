// ---------------------------------------------------------------------------
// Defense Industry detection engine — public types.
//
// Derives, from live defense RSS text (title + summary), the metrics the
// Defense Industry screen shows: ranked industry segments, supply-chain
// pressure, and per-item enrichment (activity type, organization, program,
// segment, supply-chain area, buyer/supplier country roles, confidence,
// impact, priority).
//
// Everything here is INFERRED from open-source text (OSINT-safe, no verified
// attribution). The `provenance` flag makes that explicit.
//
// Output shapes match what the Defense Industry panels render directly
// (feed items / segment mentions / supply-chain pressure). The types are
// declared here to keep the engine self-contained and unit-testable.
// ---------------------------------------------------------------------------

import type { RegionId } from "../cyber/types";

export type DefenseSegmentId =
  | "aerospace"
  | "naval"
  | "uav_unmanned"
  | "land_systems"
  | "munitions"
  | "electronics"
  | "space_satellite"
  | "cyber_c4isr";

export type SupplyChainCommodityId =
  | "semiconductors"
  | "precision_components"
  | "composite_materials"
  | "energetic_materials"
  | "specialty_metals"
  | "optronics"
  | "propulsion";

/** Activity types — aligned with the panel's existing vocabulary. */
export type DefenseActivityType =
  | "Procurement"
  | "Export Review"
  | "Industrial Partnership"
  | "Production Capacity"
  | "Naval Program"
  | "UAV / Aerospace"
  | "Supply Chain"
  | "Sustainment";

/** Country role in a defense-industrial event. */
export type DefenseCountryRole = "buyer" | "supplier" | "neutral";

export type ConfidenceBand = "High" | "Medium" | "Low";
export type PriorityBand = "elevated" | "high" | "medium" | "low";

export interface DefenseCountryHit {
  country: string;
  regionId: RegionId;
  role: DefenseCountryRole;
  evidence: string;
}

/** Per-item context (matches the Industry Context panel fields). */
export interface DefenseContext {
  countryRegion: string;
  organization: string;
  program: string;
  activityType: string;
  industrySegment: string;
  supplyChainArea: string;
  summary: string;
  sourceType: string;
  firstSeen: string;
  lastUpdate: string;
  confidence: ConfidenceBand;
  impact: ConfidenceBand;
  confidenceLevel: number; // 1..5
  impactLevel: number; // 1..5
}

/** A live feed item (matches DefenseFeedItem, plus decoupled enrichment). */
export interface DefenseFeedItemLive {
  id: string;
  headline: string;
  source: string;
  timeAgo: string;
  summary: string;
  activityType: string;
  priority: string;
  url?: string;
  publishedAt?: string;
  context: DefenseContext;
  /** Detected countries with buyer/supplier roles (for tooltip/debug). */
  countries?: DefenseCountryHit[];
}

/** Key Segments row (matches DefenseSegmentMention). */
export interface DefenseSegmentMetric {
  rank: number;
  segment: string;
  count: number;
  /** Momentum within the current feed: recent share − older share (pp). */
  change: number;
}

/** Supply Chain Pressure row (matches DefenseSupplyChainPressure). */
export interface DefenseSupplyChainMetric {
  name: string;
  score: number; // 0..100 stress-weighted
  status: "Critical" | "High" | "Elevated" | "Moderate";
  /** How many items mentioned the commodity (for tooltip/debug). */
  mentions?: number;
}

export interface DefenseSignalInput {
  id?: string;
  title: string;
  summary?: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  collectedAt?: string;
  /** Source verification hint ("official" lifts confidence). */
  verificationStatus?: string;
  sourceType?: string;
}

export interface DefenseAnalysisResult {
  totalItems: number;
  /** Items that passed the defense-industry relevance gate. */
  relevantItems: number;
  items: DefenseFeedItemLive[];
  segments: DefenseSegmentMetric[];
  supplyChain: DefenseSupplyChainMetric[];
  provenance: "derived_from_rss_text";
  inferred: true;
}

export interface DefenseAnalyzeOptions {
  /** Drop items that fail the relevance gate (default true). */
  gateRelevance?: boolean;
  maxItems?: number;
}
