// ---------------------------------------------------------------------------
// Policy Dossier per-item detection.
//
// Reuses cyber normalization and geography, while adding Policy-specific
// topic, severity, relevance, tag, and confidence heuristics.
// ---------------------------------------------------------------------------

import type { PolicySeverity, PolicyTopic } from "../../types/policy";
import type { RegionId } from "../cyber/types";
import { findTermSpans, normalizeText } from "../cyber/normalize";
import {
  NORMALIZED_COUNTRIES,
  REGION_DIRECT,
  regionLabel,
  type NormalizedCountry,
} from "../cyber/geoLexicon";
import type {
  PolicyCountryHit,
  PolicyDetection,
  PolicyRegionHit,
} from "./types";
import {
  NORM_DEESCALATION,
  NORM_ESCALATION,
  NORM_MAGNITUDE,
  NORM_RELEVANCE,
  NORM_TOPICS,
  TOPIC_ORDER,
  type NormPattern,
} from "./lexicon";

interface LooseSpan {
  start: number;
  end: number;
}

const looseCache = new Map<string, RegExp>();

function looseRegex(term: string): RegExp {
  let re = looseCache.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${escaped}(?:e?s)?(?![a-z0-9])`, "g");
    looseCache.set(term, re);
  }
  re.lastIndex = 0;
  return re;
}

function looseSpans(text: string, term: string): LooseSpan[] {
  if (!term) return [];
  const re = looseRegex(term);
  const spans: LooseSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return spans;
}

interface ScoreResult {
  score: number;
  maxWeight: number;
  matched: string[];
}

/** Sum weights of distinct matched patterns, longest-first, overlap-suppressed. */
function scorePatterns(text: string, patterns: readonly NormPattern[]): ScoreResult {
  let score = 0;
  let maxWeight = 0;
  const matched: string[] = [];
  const claimed: Array<{ start: number; end: number }> = [];
  for (const { term, weight } of patterns) {
    const span = looseSpans(text, term).find(
      (s) => !claimed.some((c) => s.start < c.end && s.end > c.start),
    );
    if (!span) continue;
    claimed.push(span);
    score += weight;
    maxWeight = Math.max(maxWeight, weight);
    matched.push(term);
  }
  return { score, maxWeight, matched };
}

function hasAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => looseSpans(text, term).length > 0);
}

interface TopicScore {
  topic: PolicyTopic;
  score: number;
  maxWeight: number;
  matched: string[];
}

function classifyTopic(text: string): TopicScore {
  const scores = NORM_TOPICS.map((entry) => ({
    topic: entry.topic,
    ...scorePatterns(text, entry.norm),
  })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.maxWeight !== a.maxWeight) return b.maxWeight - a.maxWeight;
    return TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic);
  });

  const qualified = scores.find((s) => s.score >= 2);
  if (qualified) return qualified;
  const weak = scores.find((s) => s.score > 0);
  return weak ?? { topic: "Diplomacy", score: 0, maxWeight: 0, matched: [] };
}

interface GeoToken {
  term: string;
  country: NormalizedCountry;
}

const GEO_TOKENS: GeoToken[] = (() => {
  const tokens: GeoToken[] = [];
  for (const country of NORMALIZED_COUNTRIES) {
    for (const alias of country.normAliases) tokens.push({ term: alias, country });
    for (const demonym of country.normDemonyms) tokens.push({ term: demonym, country });
  }
  return tokens.sort((a, b) => b.term.length - a.term.length);
})();

const DIRECT_REGION_TOKENS = REGION_DIRECT.flatMap((entry) =>
  entry.terms.map((term) => ({ regionId: entry.regionId, term: normalizeText(term) })),
).sort((a, b) => b.term.length - a.term.length);

function detectGeo(text: string): {
  displayRegion: string;
  countries: PolicyCountryHit[];
  regions: PolicyRegionHit[];
} {
  const countryMap = new Map<string, PolicyCountryHit>();
  const claimed: Array<{ start: number; end: number }> = [];

  for (const token of GEO_TOKENS) {
    for (const span of findTermSpans(text, token.term)) {
      if (claimed.some((c) => span.start < c.end && span.end > c.start)) continue;
      claimed.push(span);
      const existing = countryMap.get(token.country.name);
      if (existing) {
        existing.mentions += 1;
        if (!existing.evidence.includes(token.term)) existing.evidence.push(token.term);
      } else {
        countryMap.set(token.country.name, {
          country: token.country.name,
          regionId: token.country.regionId,
          mentions: 1,
          evidence: [token.term],
        });
      }
    }
  }

  const directRegionCounts = new Map<RegionId, number>();
  for (const token of DIRECT_REGION_TOKENS) {
    const count = findTermSpans(text, token.term).length;
    if (count > 0) {
      directRegionCounts.set(token.regionId, (directRegionCounts.get(token.regionId) ?? 0) + count);
    }
  }

  const countries = [...countryMap.values()].sort((a, b) => b.mentions - a.mentions);
  const regionCounts = new Map<RegionId, number>();
  for (const country of countries) {
    regionCounts.set(country.regionId, (regionCounts.get(country.regionId) ?? 0) + country.mentions);
  }
  for (const [regionId, count] of directRegionCounts) {
    regionCounts.set(regionId, (regionCounts.get(regionId) ?? 0) + count);
  }

  const regions = [...regionCounts.entries()]
    .map(([regionId, mentions]) => ({ regionId, label: regionLabel(regionId), mentions }))
    .sort((a, b) => b.mentions - a.mentions);

  let displayRegion = "Global / Unspecified";
  if (countries.length === 1) {
    displayRegion = countries[0].country;
  } else if (countries.length > 1 && countries[0].mentions > countries[1].mentions) {
    displayRegion = countries[0].country;
  } else if (regions.length === 1) {
    displayRegion = regions[0].label;
  } else if (regions.length > 1) {
    displayRegion = "Global / Multi-region";
  }

  return { displayRegion, countries, regions };
}

function severityFromSignals(
  topic: PolicyTopic,
  escalation: ScoreResult,
  magnitude: ScoreResult,
  deescalation: ScoreResult,
): PolicySeverity {
  let level = topic === "Crisis & Conflict" ? 2 : 1;

  if (escalation.score >= 6 || (escalation.score >= 3 && magnitude.score >= 2)) {
    level = 4;
  } else if (escalation.score >= 3 || magnitude.score >= 4) {
    level = 3;
  } else if (escalation.score >= 2 || magnitude.score >= 2 || topic !== "Diplomacy") {
    level = Math.max(level, 2);
  }

  if (deescalation.score >= 4) level -= 2;
  else if (deescalation.score >= 2) level -= 1;

  level = Math.max(1, Math.min(4, level));
  if (level >= 4) return "critical";
  if (level === 3) return "high";
  if (level === 2) return "medium";
  return "low";
}

function titleCaseTag(term: string): string {
  return term
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 3 && part === part.toLowerCase()) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function buildTags(groups: readonly string[][], topic: PolicyTopic): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const term of group) {
      const tag = titleCaseTag(term);
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length >= 4) return tags;
    }
  }
  if (tags.length === 0) tags.push(topic);
  return tags.slice(0, 4);
}

function confidenceBand(level: number): "high" | "medium" | "low" {
  if (level >= 4) return "high";
  if (level >= 3) return "medium";
  return "low";
}

export function detectPolicy(
  title: string,
  summary = "",
  opts: { official?: boolean } = {},
): PolicyDetection {
  const text = `${normalizeText(title)} . ${normalizeText(summary)}`.trim();
  const topic = classifyTopic(text);
  const escalation = scorePatterns(text, NORM_ESCALATION);
  const magnitude = scorePatterns(text, NORM_MAGNITUDE);
  const deescalation = scorePatterns(text, NORM_DEESCALATION);
  const geo = detectGeo(text);

  const relevant = topic.score >= 2 || hasAny(text, NORM_RELEVANCE);
  const sev = severityFromSignals(topic.topic, escalation, magnitude, deescalation);
  const tags = buildTags(
    [topic.matched, escalation.matched, magnitude.matched, deescalation.matched],
    topic.topic,
  );

  let confidenceLevel = relevant ? 2 : 1;
  if (topic.score >= 2) confidenceLevel += 1;
  if (geo.countries.length > 0 || geo.regions.length > 0) confidenceLevel += 1;
  if (opts.official) confidenceLevel += 1;
  confidenceLevel = Math.max(1, Math.min(5, confidenceLevel));

  return {
    relevant,
    topic: topic.topic,
    topicScore: topic.score,
    region: geo.displayRegion,
    sev,
    tags,
    countries: geo.countries,
    regions: geo.regions,
    confidence: confidenceBand(confidenceLevel),
    confidenceLevel,
  };
}

export { scorePatterns };
