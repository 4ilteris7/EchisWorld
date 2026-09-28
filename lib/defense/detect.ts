// ---------------------------------------------------------------------------
// Defense Industry per-item detection.
//
// Reuses the cyber module's normalization + country/region gazetteer, and adds
// defense-specific detection: industry segment, supply-chain commodity + stress,
// activity type, prime contractor, platform/program, and buyer/supplier country
// role attribution ("X to buy Y from Z" → X buyer, Z supplier).
// ---------------------------------------------------------------------------

import type {
  ConfidenceBand,
  DefenseActivityType,
  DefenseCountryHit,
  DefenseCountryRole,
  DefenseSegmentId,
  PriorityBand,
  SupplyChainCommodityId,
} from "./types";
import { normalizeText, findTermSpans } from "../cyber/normalize";
import { NORMALIZED_COUNTRIES, regionLabel, type NormalizedCountry } from "../cyber/geoLexicon";
import {
  NORM_ACTIVITIES,
  NORM_COMMODITIES,
  NORM_CONTRACTORS,
  NORM_PLATFORMS,
  NORM_RELEVANCE,
  NORM_SEGMENTS,
  NORM_STRESS,
  SEGMENT_LABELS,
  type NormPattern,
} from "./lexicon";

const WINDOW = 60;

// Plural-tolerant span matcher: allows an optional trailing "s"/"es" on the
// term's final word so "tank" matches "tanks", "f-35" matches "f-35s",
// "main battle tank" matches "main battle tanks". Country matching does NOT use
// this (country names are not pluralized) — it uses the exact findTermSpans.
const _looseCache = new Map<string, RegExp>();
function looseRegex(term: string): RegExp {
  let re = _looseCache.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${escaped}(?:e?s)?(?![a-z0-9])`, "g");
    _looseCache.set(term, re);
  }
  re.lastIndex = 0;
  return re;
}

interface LooseSpan { start: number; end: number }
function looseSpans(text: string, term: string): LooseSpan[] {
  if (!term) return [];
  const re = looseRegex(term);
  const spans: LooseSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;
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
    const spans = looseSpans(text, term);
    const span = spans.find((s) => !claimed.some((c) => s.start < c.end && s.end > c.start));
    if (!span) continue;
    claimed.push(span);
    score += weight;
    if (weight > maxWeight) maxWeight = weight;
    matched.push(term);
  }
  return { score, maxWeight, matched };
}

function hasAny(text: string, terms: readonly string[]): boolean {
  return terms.some((t) => looseSpans(text, t).length > 0);
}

function aliasHit(text: string, aliases: readonly string[]): boolean {
  return aliases.some((a) => looseSpans(text, a).length > 0);
}

// ── Country role attribution ────────────────────────────────────────────────

const BUYER_AFTER =
  /^(?:'s)?\s+(?:to\s+|will\s+|plans?\s+to\s+|is\s+set\s+to\s+|has\s+|had\s+|would\s+)?(?:buy|buys|bought|acquire|acquires|acquired|order|orders|ordered|procure|procures|procured|purchase|purchases|purchased|select|selects|selected|choose|chooses|chose|receive|receives|received|deploy|deploys|deployed|operate|operates)\b/;

const SUPPLIER_AFTER =
  /^(?:'s)?\s+(?:to\s+|will\s+|has\s+)?(?:supply|supplies|supplied|deliver|delivers|delivered|export|exports|exported|sell|sells|sold|provide|provides|provided|manufacture|manufactures|produced?|build|builds|built)\b/;

const SUPPLIER_TAIL =
  /^[- ](?:made|built|manufactured|designed|supplied|origin)\b/;

const BUYER_BEFORE =
  /(?:sale|sales|export|exports|deliver|delivery|deliveries|supply|sell|transfer|transfers)\s+(?:of\s+)?(?:\w+\s+){0,4}?to\s+$/;

const SUPPLIER_BEFORE =
  /(?:from|built by|made by|manufactured by|supplied by|produced by)\s+$/;

/** Demonym + company noun → that country is a supplier ("German defense firm"). */
const SUPPLIER_DEMONYM_AFTER =
  /^[ ](?:[a-z-]+ ){0,2}(?:firm|firms|company|companies|manufacturer|manufacturers|maker|makers|contractor|contractors|shipyard|defense firm|defence firm|conglomerate|industry|industries|group)\b/;

function classifyCountryRole(
  before: string,
  after: string,
  isDemonym: boolean,
): DefenseCountryRole {
  if (SUPPLIER_TAIL.test(after)) return "supplier";
  if (SUPPLIER_BEFORE.test(before)) return "supplier";
  if (SUPPLIER_AFTER.test(after)) return "supplier";
  if (isDemonym && SUPPLIER_DEMONYM_AFTER.test(after)) return "supplier";
  if (BUYER_BEFORE.test(before)) return "buyer";
  if (BUYER_AFTER.test(after)) return "buyer";
  return "neutral";
}

const ROLE_RANK: Record<DefenseCountryRole, number> = { buyer: 3, supplier: 3, neutral: 1 };

interface GeoToken {
  term: string;
  country: NormalizedCountry;
  isDemonym: boolean;
}
const GEO_TOKENS: GeoToken[] = (() => {
  const tokens: GeoToken[] = [];
  for (const c of NORMALIZED_COUNTRIES) {
    for (const a of c.normAliases) tokens.push({ term: a, country: c, isDemonym: false });
    for (const d of c.normDemonyms) tokens.push({ term: d, country: c, isDemonym: true });
  }
  return tokens.sort((a, b) => b.term.length - a.term.length);
})();

function detectCountries(text: string): DefenseCountryHit[] {
  const byCountry = new Map<string, DefenseCountryHit>();
  const claimed: Array<{ start: number; end: number }> = [];
  for (const token of GEO_TOKENS) {
    for (const span of findTermSpans(text, token.term)) {
      if (claimed.some((c) => span.start < c.end && span.end > c.start)) continue;
      claimed.push(span);
      const before = text.slice(Math.max(0, span.start - WINDOW), span.start);
      const after = text.slice(span.end, span.end + WINDOW);
      const role = classifyCountryRole(before, after, token.isDemonym);
      const existing = byCountry.get(token.country.name);
      if (!existing) {
        byCountry.set(token.country.name, {
          country: token.country.name,
          regionId: token.country.regionId,
          role,
          evidence: token.term,
        });
      } else if (ROLE_RANK[role] > ROLE_RANK[existing.role]) {
        existing.role = role;
      }
    }
  }
  return [...byCountry.values()];
}

// ── Activity classification ─────────────────────────────────────────────────

function classifyActivity(
  text: string,
  topSegment: DefenseSegmentId | undefined,
): DefenseActivityType {
  let best: { type: DefenseActivityType; score: number } | null = null;
  for (const a of NORM_ACTIVITIES) {
    const { score } = scorePatterns(text, a.norm);
    if (score >= 2 && (!best || score > best.score)) best = { type: a.type, score };
  }
  if (best) return best.type;
  // Fallback from the dominant segment.
  if (topSegment === "naval") return "Naval Program";
  if (topSegment === "uav_unmanned" || topSegment === "aerospace") return "UAV / Aerospace";
  return "Industrial Partnership";
}

// ── Confidence / impact / priority ──────────────────────────────────────────

const VALUE_SIGNALS = ["billion", "million", "multi-year", "multiyear", "largest", "record", "biggest", "$"].map(
  (t) => normalizeText(t),
);
const URGENCY_SIGNALS = ["urgent", "immediate", "breaking", "halt", "grounded", "crisis", "emergency", "scrambled"].map(
  (t) => normalizeText(t),
);
const MAJOR_ACTIVITIES = new Set<DefenseActivityType>([
  "Procurement",
  "Export Review",
  "Naval Program",
  "Production Capacity",
]);

function toBand(level: number): ConfidenceBand {
  return level >= 4 ? "High" : level >= 3 ? "Medium" : "Low";
}

export interface DefenseDetection {
  relevant: boolean;
  segments: Array<{ id: DefenseSegmentId; label: string; score: number }>;
  topSegmentLabel?: string;
  commodities: Array<{ id: SupplyChainCommodityId; name: string; mentions: number }>;
  hasStress: boolean;
  stressWeight: number;
  activityType: DefenseActivityType;
  organizations: string[];
  programs: string[];
  countries: DefenseCountryHit[];
  countryRegionLabel: string;
  organizationLabel: string;
  programLabel: string;
  supplyChainAreaLabel: string;
  industrySegmentLabel: string;
  confidence: ConfidenceBand;
  confidenceLevel: number;
  impact: ConfidenceBand;
  impactLevel: number;
  priority: PriorityBand;
}

const SEGMENT_MATCH_THRESHOLD = 2;

export function detectDefense(
  title: string,
  summary = "",
  opts: { official?: boolean } = {},
): DefenseDetection {
  const text = `${normalizeText(title)} . ${normalizeText(summary)}`.trim();

  // Platforms boost their segment strongly and provide programs.
  const programs: string[] = [];
  const platformSegmentBoost = new Map<DefenseSegmentId, number>();
  for (const p of NORM_PLATFORMS) {
    if (aliasHit(text, p.normAliases)) {
      programs.push(p.name);
      platformSegmentBoost.set(p.segment, (platformSegmentBoost.get(p.segment) ?? 0) + 3);
    }
  }

  // Segments.
  const segScores: Array<{ id: DefenseSegmentId; label: string; score: number }> = [];
  for (const s of NORM_SEGMENTS) {
    const { score, maxWeight } = scorePatterns(text, s.norm);
    const total = score + (platformSegmentBoost.get(s.id) ?? 0);
    if (total >= SEGMENT_MATCH_THRESHOLD && (maxWeight >= 2 || platformSegmentBoost.has(s.id))) {
      segScores.push({ id: s.id, label: s.label, score: total });
    }
  }
  segScores.sort((a, b) => b.score - a.score);
  const topSegment = segScores[0];

  // Contractors → organizations (+ segment hint).
  const organizations: string[] = [];
  const contractorCountries: string[] = [];
  for (const c of NORM_CONTRACTORS) {
    if (aliasHit(text, c.normAliases)) {
      organizations.push(c.name);
      if (c.country) contractorCountries.push(c.country);
    }
  }

  // Commodities + stress.
  const commodities: Array<{ id: SupplyChainCommodityId; name: string; mentions: number }> = [];
  for (const c of NORM_COMMODITIES) {
    const { score } = scorePatterns(text, c.norm);
    if (score >= 2) commodities.push({ id: c.id, name: c.name, mentions: 1 });
  }
  const stress = scorePatterns(text, NORM_STRESS);
  const hasStress = stress.score > 0;

  // Relevance gate.
  const relevant =
    segScores.length > 0 ||
    organizations.length > 0 ||
    programs.length > 0 ||
    commodities.length > 0 ||
    hasAny(text, NORM_RELEVANCE);

  // Countries + roles.
  const countries = detectCountries(text);
  // Contractor home countries count as suppliers if not already a buyer.
  for (const cc of contractorCountries) {
    const hit = countries.find((k) => k.country === cc);
    if (hit) {
      if (hit.role === "neutral") hit.role = "supplier";
    }
  }

  const activityType = classifyActivity(text, topSegment?.id);

  // ── Labels ──
  const buyers = countries.filter((c) => c.role === "buyer").map((c) => c.country);
  const suppliers = countries.filter((c) => c.role === "supplier").map((c) => c.country);
  const neutrals = countries.filter((c) => c.role === "neutral");
  let countryRegionLabel: string;
  if (suppliers.length > 0 && buyers.length > 0) {
    countryRegionLabel = `${suppliers.slice(0, 2).join(" / ")} → ${buyers.slice(0, 2).join(" / ")}`;
  } else if (buyers.length > 0) {
    countryRegionLabel = `${buyers.slice(0, 2).join(" / ")} (buyer)`;
  } else if (suppliers.length > 0) {
    countryRegionLabel = `${suppliers.slice(0, 2).join(" / ")} (supplier)`;
  } else if (neutrals.length === 1) {
    countryRegionLabel = neutrals[0].country;
  } else if (neutrals.length > 1) {
    const regions = new Set(neutrals.map((c) => c.regionId));
    countryRegionLabel = regions.size === 1 ? regionLabel([...regions][0]) : "Multi-region";
  } else {
    countryRegionLabel = "Global / Unspecified";
  }

  const organizationLabel =
    organizations[0] ??
    (hasAny(text, [normalizeText("pentagon")]) ? "Pentagon" :
     hasAny(text, [normalizeText("nato")]) ? "NATO" :
     hasAny(text, [normalizeText("ministry of defense"), normalizeText("defense ministry")]) ? "Defense Ministry" :
     "Not specified");
  const programLabel = programs[0] ?? "Not specified";
  const supplyChainAreaLabel =
    commodities.length > 0 ? commodities.slice(0, 3).map((c) => c.name).join(", ") : "Not specified";
  const industrySegmentLabel = topSegment?.label ?? "Not specified";

  // Confidence: concrete signals + official source.
  let signals = 0;
  if (organizations.length > 0) signals += 1;
  if (programs.length > 0) signals += 1;
  if (buyers.length > 0 || suppliers.length > 0) signals += 1;
  if (commodities.length > 0) signals += 1;
  if (topSegment) signals += 1;
  const confidenceLevel = Math.min(5, Math.max(2, (opts.official ? 3 : 2) + Math.min(signals, 3) - 1));
  const confidence = toBand(confidenceLevel);

  // Impact: value + major activity + urgency.
  const valueHit = hasAny(text, VALUE_SIGNALS);
  const urgencyHit = hasAny(text, URGENCY_SIGNALS);
  let impactLevel = 2;
  if (MAJOR_ACTIVITIES.has(activityType)) impactLevel += 1;
  if (valueHit) impactLevel += 1;
  if (hasStress && activityType === "Supply Chain") impactLevel += 1;
  impactLevel = Math.min(5, impactLevel);
  const impact = toBand(impactLevel);

  const priority: PriorityBand =
    impactLevel >= 4 && urgencyHit ? "elevated" :
    impactLevel >= 4 ? "high" :
    impactLevel >= 3 ? "medium" : "low";

  return {
    relevant,
    segments: segScores,
    topSegmentLabel: topSegment?.label,
    commodities,
    hasStress,
    stressWeight: stress.score,
    activityType,
    organizations,
    programs,
    countries,
    countryRegionLabel,
    organizationLabel,
    programLabel,
    supplyChainAreaLabel,
    industrySegmentLabel,
    confidence,
    confidenceLevel,
    impact,
    impactLevel,
    priority,
  };
}

export { SEGMENT_LABELS };
