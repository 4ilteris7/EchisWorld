// ---------------------------------------------------------------------------
// Policy Dossier detection engine - public types.
//
// Derives live Policy screen report metadata from RSS title + summary text.
// Everything is inferred from open-source text, not verified attribution.
// ---------------------------------------------------------------------------

import type {
  PolicyReport,
  PolicySeverity,
  PolicyTopic,
} from "../../types/policy";
import type { RegionId } from "../cyber/types";

export type PolicyConfidenceBand = "high" | "medium" | "low";

export interface PolicySignalInput {
  id?: string;
  title: string;
  summary?: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  collectedAt?: string;
  verificationStatus?: string;
  sourceType?: string;
}

export interface PolicyCountryHit {
  country: string;
  regionId: RegionId;
  mentions: number;
  evidence: string[];
}

export interface PolicyRegionHit {
  regionId: RegionId;
  label: string;
  mentions: number;
}

export interface PolicyTopicMetric {
  topic: PolicyTopic;
  count: number;
  share: number;
  rank: number;
}

export interface PolicyRegionMetric {
  region: string;
  count: number;
  pct: number;
  countries: string[];
}

export interface PolicyReportLive extends PolicyReport {
  url?: string;
  publishedAt?: string;
  collectedAt?: string;
  confidence: PolicyConfidenceBand;
  confidenceLevel: number;
  countries?: PolicyCountryHit[];
  provenance: "derived_from_rss_text";
  inferred: true;
}

export interface PolicyDetection {
  relevant: boolean;
  topic: PolicyTopic;
  topicScore: number;
  region: string;
  sev: PolicySeverity;
  tags: string[];
  countries: PolicyCountryHit[];
  regions: PolicyRegionHit[];
  confidence: PolicyConfidenceBand;
  confidenceLevel: number;
}

export interface PolicyAnalysisResult {
  totalItems: number;
  relevantItems: number;
  items: PolicyReportLive[];
  topics: PolicyTopicMetric[];
  regions: PolicyRegionMetric[];
  provenance: "derived_from_rss_text";
  inferred: true;
}

export interface PolicyAnalyzeOptions {
  gateRelevance?: boolean;
  maxItems?: number;
}
