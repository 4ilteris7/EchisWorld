// ---------------------------------------------------------------------------
// Orchestrator: live Policy RSS items -> Policy Dossier reports and metrics.
// ---------------------------------------------------------------------------

import { POLICY_TOPICS, type PolicyTopic } from "../../types/policy";
import type {
  PolicyAnalysisResult,
  PolicyAnalyzeOptions,
  PolicyRegionMetric,
  PolicyReportLive,
  PolicySignalInput,
  PolicyTopicMetric,
} from "./types";
import { detectPolicy } from "./detect";

function minutesFromPublishedAt(iso?: string): number {
  const ts = new Date(iso || "").getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function topicMetrics(items: readonly PolicyReportLive[]): PolicyTopicMetric[] {
  const counts = new Map<PolicyTopic, number>();
  for (const topic of POLICY_TOPICS) counts.set(topic, 0);
  for (const item of items) counts.set(item.topic, (counts.get(item.topic) ?? 0) + 1);
  const total = items.length || 1;
  return POLICY_TOPICS.map((topic, index) => ({
    topic,
    count: counts.get(topic) ?? 0,
    share: (counts.get(topic) ?? 0) / total,
    rank: index + 1,
  })).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return POLICY_TOPICS.indexOf(a.topic) - POLICY_TOPICS.indexOf(b.topic);
  }).map((row, index) => ({ ...row, rank: index + 1 }));
}

function regionMetrics(items: readonly PolicyReportLive[]): PolicyRegionMetric[] {
  const counts = new Map<string, { count: number; countries: Set<string> }>();
  for (const item of items) {
    const entry = counts.get(item.region) ?? { count: 0, countries: new Set<string>() };
    entry.count += 1;
    for (const country of item.countries ?? []) entry.countries.add(country.country);
    counts.set(item.region, entry);
  }
  const sorted = [...counts.entries()]
    .map(([region, entry]) => ({
      region,
      count: entry.count,
      countries: [...entry.countries].slice(0, 4),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const max = Math.max(1, ...sorted.map((row) => row.count));
  return sorted.map((row) => ({ ...row, pct: Math.round((row.count / max) * 100) }));
}

export function analyzePolicySignals(
  inputs: readonly PolicySignalInput[],
  options: PolicyAnalyzeOptions = {},
): PolicyAnalysisResult {
  const gate = options.gateRelevance !== false;
  const items: PolicyReportLive[] = [];

  inputs.forEach((input, index) => {
    const detection = detectPolicy(input.title ?? "", input.summary ?? "", {
      official:
        input.verificationStatus === "official" ||
        input.verificationStatus === "official_statement" ||
        input.verificationStatus === "official_entry",
    });
    if (gate && !detection.relevant) return;

    const publishedAt = input.publishedAt || input.collectedAt;
    const summary = input.summary || "No summary provided by the source.";
    items.push({
      id: input.id ?? `policy-live-${index}`,
      topic: detection.topic,
      region: detection.region,
      sourceType: "News",
      source: input.source ?? "OSINT",
      sev: detection.sev,
      minsAgo: minutesFromPublishedAt(publishedAt),
      title: input.title,
      summary,
      body: summary,
      tags: detection.tags,
      url: input.url,
      publishedAt,
      collectedAt: input.collectedAt,
      confidence: detection.confidence,
      confidenceLevel: detection.confidenceLevel,
      countries: detection.countries,
      provenance: "derived_from_rss_text",
      inferred: true,
    });
  });

  const finalItems = options.maxItems == null ? items : items.slice(0, options.maxItems);

  return {
    totalItems: inputs.length,
    relevantItems: items.length,
    items: finalItems,
    topics: topicMetrics(items),
    regions: regionMetrics(items),
    provenance: "derived_from_rss_text",
    inferred: true,
  };
}
