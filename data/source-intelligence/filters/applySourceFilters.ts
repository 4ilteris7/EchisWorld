import type {
  ExtractionMethod,
  MarkerEligibility,
  NormalizedSourceItem,
  SourceBasis,
  SourceFilterDomain,
  SourceFilterMatch,
  SourceFilterResult,
  VerificationStatus,
} from "../sourceIntelligenceTypes";
import {
  addEventEntityDetectionMs,
  incrementCheapPrefilterRejectedCount,
  incrementFullContextProcessedCount,
} from "../pipelineProfiling";
import { keywordDictionaries } from "./keywordDictionaries";
import { containsNormalizedPhrase, normalizeFilterText } from "./normalizeFilterText";
import { classifySourceContext } from "./contextClassifier";
import {
  domainTags,
  FILTER_ACCEPTANCE_THRESHOLD,
  scoreGroup,
  strongTriggerGroups,
} from "./geopoliticalFilterRules";

type GroupSpec = {
  domain: SourceFilterDomain;
  groupName: string;
  keywords: readonly string[];
};

const groupedKeywordSpecs: GroupSpec[] = [
  { domain: "diplomacy", groupName: "diplomacy.hard", keywords: keywordDictionaries.diplomacy.hard },
  { domain: "diplomacy", groupName: "diplomacy.context", keywords: keywordDictionaries.diplomacy.context },
  { domain: "diplomacy", groupName: "diplomacy.actions", keywords: keywordDictionaries.diplomacy.actions },
  { domain: "diplomacy", groupName: "diplomacy.actors", keywords: keywordDictionaries.diplomacy.actors },
  { domain: "diplomacy", groupName: "diplomacy.institutions", keywords: keywordDictionaries.diplomacy.institutions },
  { domain: "official_statement", groupName: "officialStatement.hard", keywords: keywordDictionaries.officialStatement.hard },
  { domain: "official_statement", groupName: "officialStatement.actions", keywords: keywordDictionaries.officialStatement.actions },
  { domain: "official_statement", groupName: "officialStatement.institutions", keywords: keywordDictionaries.officialStatement.institutions },
  { domain: "conflict", groupName: "conflict.hard", keywords: keywordDictionaries.conflict.hard },
  { domain: "conflict", groupName: "conflict.geography", keywords: keywordDictionaries.conflict.geography },
  { domain: "conflict", groupName: "conflict.escalation", keywords: keywordDictionaries.conflict.escalation },
  { domain: "peace_process", groupName: "peaceProcess.hard", keywords: keywordDictionaries.peaceProcess.hard },
  { domain: "peace_process", groupName: "peaceProcess.actions", keywords: keywordDictionaries.peaceProcess.actions },
  { domain: "crisis", groupName: "crisisHumanitarian.hard", keywords: keywordDictionaries.crisisHumanitarian.hard },
  { domain: "humanitarian", groupName: "crisisHumanitarian.hard", keywords: keywordDictionaries.crisisHumanitarian.hard },
  { domain: "sanctions_law", groupName: "sanctionsLaw.hard", keywords: keywordDictionaries.sanctionsLaw.hard },
  { domain: "border_territory", groupName: "borderTerritory.hard", keywords: keywordDictionaries.borderTerritory.hard },
  { domain: "instability", groupName: "instability.hard", keywords: keywordDictionaries.instability.hard },
  { domain: "international_org", groupName: "internationalOrganizations", keywords: keywordDictionaries.internationalOrganizations },
  { domain: "diplomacy", groupName: "geopoliticalRegions", keywords: keywordDictionaries.geopoliticalRegions },
];

const MAX_FILTER_BODY_CHARS = 1_500;

function textForItem(item: NormalizedSourceItem): string {
  if (item.normalizedFilterText !== undefined) return item.normalizedFilterText;
  const text = normalizeFilterText(
    [
      item.title,
      item.summary,
      item.bodyText?.slice(0, MAX_FILTER_BODY_CHARS),
      item.sourceName,
      item.legacyCategory,
      item.mentionedCountries?.join(" "),
      item.mentionedRegions?.join(" "),
      item.institutions?.join(" "),
      item.organizations?.join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
  item.normalizedFilterText = text;
  return text;
}

function defaults(item: NormalizedSourceItem): {
  sourceBasis: SourceBasis;
  verificationStatus: VerificationStatus;
  extractionMethod: ExtractionMethod;
} {
  return {
    sourceBasis:
      item.sourceBasis ??
      (item.sourceType === "official_government" ||
      item.sourceType === "intergovernmental_org"
        ? "official_source"
        : "source_reported"),
    verificationStatus:
      item.verificationStatus ??
      (item.sourceType === "official_government" ||
      item.sourceType === "intergovernmental_org"
        ? "official"
        : "reported"),
    extractionMethod:
      item.extractionMethod ??
      (item.collectionMethod === "rss" ? "rss_summary" : "api_payload"),
  };
}

function emptyReject(
  item: NormalizedSourceItem,
  rejectedBy: SourceFilterResult<NormalizedSourceItem>["rejectedBy"],
): SourceFilterResult<NormalizedSourceItem> {
  const inferred = defaults(item);
  return {
    item,
    accepted: false,
    tags: [],
    relevanceScore: 0,
    priorityScore: 0,
    sourceBasis: inferred.sourceBasis,
    verificationStatus: inferred.verificationStatus,
    extractionMethod: inferred.extractionMethod,
    matchedKeywords: [],
    matches: [],
    markerEligibility: "rejected",
    rejectedBy,
  };
}

function domainForEventType(
  eventType: ReturnType<typeof classifySourceContext>["eventType"],
): SourceFilterDomain | undefined {
  switch (eventType) {
    case "condemnation":
    case "warning":
    case "official_statement":
    case "diplomatic_message":
    case "official_appointment":
    case "government_appointment":
    case "national_security_appointment":
    case "internal_government_decision":
      return "official_statement";
    case "diplomatic_visit":
    case "meeting":
    case "summit":
    case "defense_policy":
    case "defense_appointment":
    case "diplomatic_appointment":
      return "diplomacy";
    case "attack":
    case "strike":
    case "drone_strike":
    case "missile_strike":
    case "clash":
    case "military_operation":
    case "military_incident":
    case "strategic_waterway":
    case "maritime_security":
      return "conflict";
    case "sanctions_announcement":
    case "sanctions_impact":
    case "legal_decision":
      return "sanctions_law";
    case "humanitarian_crisis":
    case "health_outbreak":
      return "humanitarian";
    default:
      return undefined;
  }
}

export function applySourceFilters(
  items: NormalizedSourceItem[],
): SourceFilterResult<NormalizedSourceItem>[] {
  return items.map((item) => {
    const text = textForItem(item);
    if (!text) return emptyReject(item, "missing_text");

    const domainScores = new Map<SourceFilterDomain, SourceFilterMatch>();
    const matchedKeywords = new Set<string>();
    const matchedGroups = new Set<string>();
    let relevanceScore = 0;
    let priorityScore = 0;
    let hasStrongTrigger = false;

    for (const spec of groupedKeywordSpecs) {
      const groupMatches = spec.keywords.filter((keyword) =>
        containsNormalizedPhrase(text, keyword),
      );
      if (groupMatches.length === 0) continue;

      const groupScore = scoreGroup(spec.groupName);
      const totalGroupScore = groupScore + Math.min(groupMatches.length - 1, 3) * 3;
      relevanceScore += totalGroupScore;
      priorityScore += totalGroupScore;
      matchedGroups.add(spec.groupName);
      groupMatches.forEach((keyword) => matchedKeywords.add(keyword));
      if (strongTriggerGroups.has(spec.groupName)) hasStrongTrigger = true;

      const existing = domainScores.get(spec.domain);
      if (existing) {
        existing.score += totalGroupScore;
        existing.matchedKeywords.push(...groupMatches);
        existing.matchedGroups.push(spec.groupName);
      } else {
        domainScores.set(spec.domain, {
          domain: spec.domain,
          score: totalGroupScore,
          matchedKeywords: [...groupMatches],
          matchedGroups: [spec.groupName],
        });
      }
    }

    const negativeMatches = keywordDictionaries.negativeNoise.filter((keyword) =>
      containsNormalizedPhrase(text, keyword),
    );
    if (negativeMatches.length > 0) {
      relevanceScore = Math.max(0, relevanceScore - 5);
      priorityScore = Math.max(0, priorityScore - 5);
    }

    const contextStart = performance.now();
    const context = classifySourceContext(item);
    addEventEntityDetectionMs(performance.now() - contextStart);
    incrementFullContextProcessedCount();

    const contextDomain = domainForEventType(context.eventType);
    const hasContextGeopoliticalOverride =
      !!contextDomain && context.eventType !== "analysis_or_opinion";
    const finalGuardReason = context.filterGuardReason;
    const finalNoMarkerReason = context.noMarkerReason;

    if (finalGuardReason && !hasContextGeopoliticalOverride) {
      incrementCheapPrefilterRejectedCount();
      return {
        ...emptyReject(item, "negative_noise"),
        eventType: context.eventType,
        entityRoles: context.entityRoles,
        contextReasons: context.contextReasons,
        filterGuardReason: finalGuardReason,
        noMarkerReason: finalNoMarkerReason,
      };
    }

    if (negativeMatches.length > 0 && !hasStrongTrigger && !hasContextGeopoliticalOverride) {
      incrementCheapPrefilterRejectedCount();
      return {
        ...emptyReject(item, "negative_noise"),
        eventType: context.eventType,
        entityRoles: context.entityRoles,
        contextReasons: context.contextReasons,
        filterGuardReason: finalGuardReason,
        noMarkerReason: finalNoMarkerReason,
      };
    }

    const inferred = defaults(item);
    if (
      inferred.sourceBasis === "official_source" ||
      inferred.verificationStatus === "official"
    ) {
      relevanceScore += 15;
      priorityScore += 15;
    }

    // Aggregator API sources (e.g. GDELT) are pre-filtered at query time with
    // explicit geopolitical keywords, so they carry an implicit topical signal
    // that title-only scoring underweights.  Apply a source-type bonus so
    // single-keyword geopolitical titles are not discarded as noise.
    if (item.collectionMethod === "aggregator_api") {
      relevanceScore += 20;
      priorityScore += 20;
    }

    if (domainScores.size > 1) {
      relevanceScore += 10;
      priorityScore += 10;
    }

    if (contextDomain && context.eventType !== "analysis_or_opinion") {
      const contextScore =
        context.eventType === "unknown" ? 0 :
        context.eventType === "health_outbreak" ? 28 :
        28;
      relevanceScore += contextScore;
      priorityScore += contextScore;
      matchedGroups.add(`context.${context.eventType}`);
      matchedKeywords.add(context.eventType);
      const existing = domainScores.get(contextDomain);
      if (existing) {
        existing.score += contextScore;
        existing.matchedKeywords.push(context.eventType);
        existing.matchedGroups.push(`context.${context.eventType}`);
      } else {
        domainScores.set(contextDomain, {
          domain: contextDomain,
          score: contextScore,
          matchedKeywords: [context.eventType],
          matchedGroups: [`context.${context.eventType}`],
        });
      }
    }

    const matches = [...domainScores.values()].sort((a, b) => b.score - a.score);
    const primaryDomain = matches[0]?.domain;
    const accepted = relevanceScore >= FILTER_ACCEPTANCE_THRESHOLD && !!primaryDomain;
    const markerEligibility: MarkerEligibility = accepted
      ? context.eventType === "analysis_or_opinion"
        ? "feed_only"
        : item.locationHint
        ? "eligible"
        : "needs_location"
      : "rejected";

    return {
      item,
      accepted,
      primaryDomain,
      tags: matches.map((match) => domainTags[match.domain]),
      relevanceScore,
      priorityScore,
      sourceBasis: inferred.sourceBasis,
      verificationStatus: inferred.verificationStatus,
      extractionMethod: inferred.extractionMethod,
      matchedKeywords: [...matchedKeywords],
      matches,
      markerEligibility,
      eventType: context.eventType,
      entityRoles: context.entityRoles,
      noMarkerReason: context.noMarkerReason,
      contextReasons: context.contextReasons,
      filterGuardReason: context.filterGuardReason,
      rejectedBy: accepted ? undefined : "low_relevance",
    };
  });
}
