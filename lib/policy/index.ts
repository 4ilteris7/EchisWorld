// Public barrel for the Policy Dossier detection engine.

export { analyzePolicySignals } from "./analyzePolicySignals";
export { detectPolicy } from "./detect";
export type {
  PolicyAnalysisResult,
  PolicyAnalyzeOptions,
  PolicyConfidenceBand,
  PolicyCountryHit,
  PolicyDetection,
  PolicyRegionHit,
  PolicyRegionMetric,
  PolicyReportLive,
  PolicySignalInput,
  PolicyTopicMetric,
} from "./types";
