// ---------------------------------------------------------------------------
// Orchestrator: live defense RSS items → Defense Industry screen metrics.
//
//   analyzeDefenseSignals(items) → {
//     items:      DefenseFeedItemLive[]     // Feed + Industry Context panels
//     segments:   DefenseSegmentMetric[]    // Key Segments panel
//     supplyChain:DefenseSupplyChainMetric[]// Supply Chain Pressure panel
//   }
//
// All inferred from open-source RSS text (provenance flag set). Supply-chain
// pressure is stress-weighted; country roles are buyer/supplier attributed.
// ---------------------------------------------------------------------------

import type {
  DefenseAnalysisResult,
  DefenseAnalyzeOptions,
  DefenseFeedItemLive,
  DefenseSegmentId,
  DefenseSegmentMetric,
  DefenseSignalInput,
  DefenseSupplyChainMetric,
  SupplyChainCommodityId,
} from "./types";
import { detectDefense } from "./detect";
import { SEGMENT_LABELS } from "./lexicon";

function formatTimeAgo(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor(Math.max(0, Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

function supplyStatus(score: number): DefenseSupplyChainMetric["status"] {
  if (score >= 75) return "Critical";
  if (score >= 55) return "High";
  if (score >= 35) return "Elevated";
  return "Moderate";
}

export function analyzeDefenseSignals(
  inputs: readonly DefenseSignalInput[],
  options: DefenseAnalyzeOptions = {},
): DefenseAnalysisResult {
  const gate = options.gateRelevance !== false;

  const items: DefenseFeedItemLive[] = [];
  // Segment presence per relevant item (index-aligned with `items`).
  const segmentPresence: Set<DefenseSegmentId>[] = [];
  // Commodity aggregation.
  const commodityMentions = new Map<SupplyChainCommodityId, { name: string; mentions: number; stressItems: number }>();

  inputs.forEach((input, index) => {
    const detection = detectDefense(input.title ?? "", input.summary ?? "", {
      official:
        input.verificationStatus === "official" ||
        input.verificationStatus === "official_statement" ||
        input.verificationStatus === "official_entry",
    });
    if (gate && !detection.relevant) return;

    const publishedAt = input.publishedAt || input.collectedAt;
    const item: DefenseFeedItemLive = {
      id: input.id ?? `df-live-${index}`,
      headline: input.title,
      source: input.source ?? "OSINT",
      timeAgo: formatTimeAgo(publishedAt),
      summary: input.summary || "No summary provided by the source.",
      activityType: detection.activityType,
      priority: detection.priority,
      url: input.url,
      publishedAt,
      countries: detection.countries,
      context: {
        countryRegion: detection.countryRegionLabel,
        organization: detection.organizationLabel,
        program: detection.programLabel,
        activityType: detection.activityType,
        industrySegment: detection.industrySegmentLabel,
        supplyChainArea: detection.supplyChainAreaLabel,
        summary: input.summary || "No summary provided by the source.",
        sourceType: input.sourceType || input.source || "Open-source reporting",
        firstSeen: formatDateTime(publishedAt),
        lastUpdate: formatDateTime(input.collectedAt || publishedAt),
        confidence: detection.confidence,
        impact: detection.impact,
        confidenceLevel: detection.confidenceLevel,
        impactLevel: detection.impactLevel,
      },
    };
    items.push(item);
    segmentPresence.push(new Set(detection.segments.map((s) => s.id)));

    for (const c of detection.commodities) {
      const agg = commodityMentions.get(c.id) ?? { name: c.name, mentions: 0, stressItems: 0 };
      agg.mentions += 1;
      if (detection.hasStress) agg.stressItems += 1;
      commodityMentions.set(c.id, agg);
    }
  });

  // ── Segments: count + within-feed momentum ────────────────────────────────
  const totalRelevant = items.length;
  const mid = Math.floor(totalRelevant / 2);
  const recentCount = mid; // items[0..mid)
  const olderCount = totalRelevant - mid; // items[mid..)

  const segTotals = new Map<DefenseSegmentId, { count: number; recent: number; older: number }>();
  segmentPresence.forEach((set, i) => {
    const isRecent = i < mid;
    for (const id of set) {
      const agg = segTotals.get(id) ?? { count: 0, recent: 0, older: 0 };
      agg.count += 1;
      if (isRecent) agg.recent += 1;
      else agg.older += 1;
      segTotals.set(id, agg);
    }
  });

  const segments: DefenseSegmentMetric[] = [...segTotals.entries()]
    .map(([id, agg]) => {
      const recentShare = recentCount > 0 ? agg.recent / recentCount : 0;
      const olderShare = olderCount > 0 ? agg.older / olderCount : 0;
      const change = Math.round((recentShare - olderShare) * 1000) / 10; // pp, 1 decimal
      return { segment: SEGMENT_LABELS[id], count: agg.count, change, rank: 0 };
    })
    .sort((a, b) => b.count - a.count)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  // ── Supply chain: stress-weighted score ───────────────────────────────────
  const supplyChain: DefenseSupplyChainMetric[] = [...commodityMentions.entries()]
    .map(([, agg]) => {
      const raw = agg.mentions * 7 + agg.stressItems * 11;
      const score = Math.min(100, agg.mentions > 0 ? Math.max(12, raw) : raw);
      return { name: agg.name, score, status: supplyStatus(score), mentions: agg.mentions };
    })
    .sort((a, b) => b.score - a.score);

  let finalItems = items;
  if (options.maxItems != null) finalItems = items.slice(0, options.maxItems);

  return {
    totalItems: inputs.length,
    relevantItems: items.length,
    items: finalItems,
    segments,
    supplyChain,
    provenance: "derived_from_rss_text",
    inferred: true,
  };
}
