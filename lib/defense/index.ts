// Public barrel for the Defense Industry detection engine.

export { analyzeDefenseSignals } from "./analyzeDefenseSignals";
export { detectDefense } from "./detect";
export { SEGMENT_LABELS } from "./lexicon";
export type {
  DefenseAnalysisResult,
  DefenseAnalyzeOptions,
  DefenseActivityType,
  DefenseContext,
  DefenseCountryHit,
  DefenseCountryRole,
  DefenseFeedItemLive,
  DefenseSegmentId,
  DefenseSegmentMetric,
  DefenseSignalInput,
  DefenseSupplyChainMetric,
  SupplyChainCommodityId,
} from "./types";
