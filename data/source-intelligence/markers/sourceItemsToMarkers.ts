import type {
  IntelligenceEventCandidate,
  SourceFilterDomain,
} from "../sourceIntelligenceTypes";
import type {
  SourceMarkerCandidate,
  SourceMarkerFeature,
} from "./sourceMarkerTypes";

function markerTypeFor(domain: SourceFilterDomain): SourceMarkerCandidate["markerType"] {
  switch (domain) {
    case "official_statement":
      return "official_statement";
    case "diplomacy":
      return "diplomatic_activity";
    case "conflict":
    case "border_territory":
    case "instability":
      return "conflict";
    case "peace_process":
      return "peace_process";
    case "crisis":
    case "humanitarian":
      return "crisis";
    case "sanctions_law":
      return "sanctions";
    case "international_org":
      return "international_org";
  }
}

function severityFor(priorityScore: number): SourceMarkerCandidate["severity"] {
  if (priorityScore >= 85) return "high_interest";
  if (priorityScore >= 70) return "important";
  return "monitoring";
}

function newestIso(values: Array<string | undefined>): string | undefined {
  const sorted = values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return sorted[0];
}

export function sourceItemsToMarkers(
  items: IntelligenceEventCandidate[],
): SourceMarkerFeature[] {
  const grouped = new Map<string, SourceMarkerFeature>();

  for (const item of items) {
    if (!item.markerEligibility || item.markerEligibility === "feed_only") {
      continue;
    }
    if (item.markerEligibility === "rejected") continue;

    // Use the location resolved during the pipeline's first geo-resolution pass
    // (stored on the candidate by buildIntelligenceEventCandidates) instead of
    // calling resolveGeoBasis a second time for the same item.
    const location = item.resolvedLocation;
    const geoBasis = item.geoBasis;
    if (!location || !geoBasis) continue;

    const markerKey = [
      location.label,
      location.latitude.toFixed(2),
      location.longitude.toFixed(2),
    ].join("::");
    const markerId = `source::${markerKey}`;
    const existing = grouped.get(markerId);

    if (existing) {
      existing.items.push(item);
      existing.candidate.itemIds.push(item.id);
      existing.candidate.tags = Array.from(
        new Set([...existing.candidate.tags, ...item.tags]),
      );
      existing.candidate.lastUpdatedAt = newestIso([
        existing.candidate.lastUpdatedAt,
        item.publishedAt,
        item.collectedAt,
      ]);
      if (item.priorityScore > existing.items[0].priorityScore) {
        existing.candidate.title = item.title;
        existing.candidate.summary = item.summary;
        existing.candidate.eventId = item.id;
        existing.candidate.markerType = markerTypeFor(item.primaryDomain);
        existing.candidate.severity = severityFor(item.priorityScore);
        existing.candidate.sourceBasis = item.sourceBasis;
      }
      continue;
    }

    const candidate: SourceMarkerCandidate = {
      id: markerId,
      eventId: item.id,
      itemIds: [item.id],
      title: item.title,
      summary: item.summary,
      latitude: location.latitude,
      longitude: location.longitude,
      locationLabel: location.label,
      markerType: markerTypeFor(item.primaryDomain),
      severity: severityFor(item.priorityScore),
      sourceBasis: item.sourceBasis,
      tags: item.tags,
      publishedAt: item.publishedAt,
      lastUpdatedAt: item.publishedAt ?? item.collectedAt,
      geoBasis,
    };

    grouped.set(markerId, {
      id: markerId,
      lng: location.longitude,
      lat: location.latitude,
      locationName: location.label,
      candidate,
      items: [item],
    });
  }

  return [...grouped.values()].sort((a, b) => {
    const aTime = new Date(a.candidate.lastUpdatedAt ?? 0).getTime();
    const bTime = new Date(b.candidate.lastUpdatedAt ?? 0).getTime();
    return bTime - aTime;
  });
}
