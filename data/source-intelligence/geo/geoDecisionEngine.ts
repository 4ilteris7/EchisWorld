import type {
  GeoBasis,
  GeoEvidence,
  GeoEvidenceRole,
  GeoEvidenceStrength,
  IntelligenceEventCandidate,
  MarkerReason,
  MarkerEligibility,
  NoMarkerReason,
  SourceDefinition,
  SourceFilterDomain,
} from "../sourceIntelligenceTypes";
import {
  findLocationResolutionCandidates,
  resolveLocationByAnchor,
  resolveLocationByCountryCode,
  type LocationResolutionCandidate,
  type ResolvedLocation,
} from "./locationResolver";

export type GeoDecision = {
  markerEligibility: MarkerEligibility;
  location?: ResolvedLocation;
  geoBasis?: GeoBasis;
  evidence: GeoEvidence[];
  markerAnchor?: string;
  markerReason?: MarkerReason;
  noMarkerReason?: NoMarkerReason;
};

type WeightedEvidence = GeoEvidence & {
  location?: ResolvedLocation;
  priority: number;
};

function reasonForDomain(domain: SourceFilterDomain): GeoBasis["reason"] {
  switch (domain) {
    case "official_statement":
      return "official_statement";
    case "conflict":
      return "conflict";
    case "crisis":
      return "crisis";
    case "humanitarian":
      return "humanitarian";
    case "peace_process":
      return "peace_process";
    case "sanctions_law":
      return "sanctions";
    case "border_territory":
      return "border_incident";
    default:
      return "fallback";
  }
}

function textForGeoResolution(candidate: IntelligenceEventCandidate): string {
  const item = candidate.item;
  return [
    item.title,
    item.summary,
    item.bodyText?.slice(0, 1_500),
    item.eventCountry,
    item.actorCountries?.join(" "),
    item.mentionedCountries?.join(" "),
    item.mentionedRegions?.join(" "),
    item.institutions?.join(" "),
    item.organizations?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function strengthForScore(score: number): GeoEvidenceStrength {
  if (score >= 88) return "strong";
  if (score >= 78) return "moderate";
  return "weak";
}

function roleForCandidate(
  candidate: LocationResolutionCandidate,
): GeoEvidenceRole {
  switch (candidate.method) {
    case "official_actor_phrase":
      return "official_actor";
    case "country_actor_phrase":
      return "country_actor";
    case "target_country_phrase":
      return "target";
    case "negotiation_location_phrase":
      return "venue";
    case "event_location_phrase":
    case "headline_location_prefix":
      return "event_location";
    case "mentioned_location_phrase":
      return "mentioned_only";
  }
}

function basisTypeForRole(role: GeoEvidenceRole): GeoBasis["type"] {
  switch (role) {
    case "institution_location":
      return "institution_location";
    case "official_actor":
    case "country_actor":
      return "actor_country";
    case "target":
      return "target_country";
    case "event_location":
    case "venue":
    case "payload_coordinates":
      return "event_location";
    default:
      return "mentioned_country";
  }
}

function rolePriority(
  domain: SourceFilterDomain,
  role: GeoEvidenceRole,
): number | null {
  if (role === "mentioned_only" || role === "source_country_fallback") {
    return null;
  }

  let priorities: Partial<Record<GeoEvidenceRole, number>>;
  switch (domain) {
    case "official_statement":
      priorities = {
        official_actor: 104,
        institution_location: 100,
        payload_coordinates: 96,
        event_location: 92,
        country_actor: 88,
        target: 78,
        venue: 76,
      };
      return priorities[role] ?? null;
    case "diplomacy":
      priorities = {
        venue: 105,
        event_location: 96,
        official_actor: 90,
        institution_location: 86,
        country_actor: 84,
        payload_coordinates: 84,
      };
      return priorities[role] ?? null;
    case "peace_process":
      priorities = {
        venue: 106,
        event_location: 98,
        target: 86,
        official_actor: 84,
        country_actor: 82,
        payload_coordinates: 84,
      };
      return priorities[role] ?? null;
    case "sanctions_law":
      priorities = {
        official_actor: 102,
        institution_location: 98,
        target: 96,
        event_location: 88,
        payload_coordinates: 86,
        country_actor: 82,
      };
      return priorities[role] ?? null;
    case "conflict":
    case "crisis":
    case "humanitarian":
    case "border_territory":
    case "instability":
      priorities = {
        event_location: 106,
        target: 98,
        payload_coordinates: 94,
        country_actor: 90,
        official_actor: 88,
        venue: 80,
      };
      return priorities[role] ?? null;
    case "international_org":
      priorities = {
        venue: 100,
        event_location: 98,
        target: 94,
        institution_location: 92,
        official_actor: 88,
        country_actor: 86,
        payload_coordinates: 86,
      };
      return priorities[role] ?? null;
  }
}

function shouldTrustLocationHint(
  candidate: IntelligenceEventCandidate,
  source: SourceDefinition,
): boolean {
  if (!candidate.item.locationHint) return false;
  if (candidate.item.sourceBasis === "official_source") return true;
  if (source.sourceType === "crisis_humanitarian") return true;
  if (source.sourceType === "conflict_dataset") return true;
  if (source.collectionMethod === "dataset") return true;
  if (source.collectionMethod === "script_import") return true;
  if (source.collectionMethod === "official_page") return true;
  return false;
}

function weightedEvidence(
  evidence: GeoEvidence,
  location: ResolvedLocation | undefined,
  domain: SourceFilterDomain,
  score = 0,
): WeightedEvidence {
  const basePriority = rolePriority(domain, evidence.role);
  const acceptedForMarker = basePriority !== null && evidence.strength !== "weak";
  return {
    ...evidence,
    acceptedForMarker,
    rejectionReason: acceptedForMarker ? undefined : evidence.rejectionReason,
    location,
    priority: acceptedForMarker ? basePriority + Math.min(score, 10) : 0,
  };
}

function institutionEvidence(
  source: SourceDefinition,
  domain: SourceFilterDomain,
): WeightedEvidence | null {
  const location = source.institutionLocation;
  if (!location) return null;
  return weightedEvidence(
    {
      role: "institution_location",
      method: "institution_location",
      locationLabel: location.label ?? location.city,
      countryCode: location.countryCode,
      evidenceText: `source institution: ${source.name}`,
      strength: "strong",
      acceptedForMarker: true,
    },
    {
      latitude: location.lat,
      longitude: location.lon,
      label: location.label ?? location.city,
      countryCode: location.countryCode,
    },
    domain,
    10,
  );
}

function payloadEvidence(
  candidate: IntelligenceEventCandidate,
  source: SourceDefinition,
): WeightedEvidence | null {
  const hint = candidate.item.locationHint;
  if (!hint) return null;
  const trusted = shouldTrustLocationHint(candidate, source);
  return weightedEvidence(
    {
      role: "payload_coordinates",
      method: "payload_coordinates",
      locationLabel: hint.label,
      countryCode: hint.countryCode,
      evidenceText: trusted
        ? "trusted source payload coordinates"
        : "untrusted general-source payload coordinates",
      strength: trusted ? "strong" : "weak",
      acceptedForMarker: trusted,
      rejectionReason: trusted ? undefined : "untrusted_payload",
    },
    {
      latitude: hint.latitude,
      longitude: hint.longitude,
      label: hint.label,
      countryCode: hint.countryCode,
    },
    candidate.primaryDomain,
    trusted ? 8 : 0,
  );
}

function locationCandidateEvidence(
  candidate: IntelligenceEventCandidate,
  locationCandidate: LocationResolutionCandidate,
): WeightedEvidence {
  const role = roleForCandidate(locationCandidate);
  const strength = strengthForScore(locationCandidate.score);
  return weightedEvidence(
    {
      role,
      method: locationCandidate.method,
      locationLabel: locationCandidate.location.label,
      countryCode: locationCandidate.location.countryCode,
      region: locationCandidate.location.region,
      matchedText: locationCandidate.matchedAlias,
      evidenceText: locationCandidate.evidence.join("; "),
      strength,
      acceptedForMarker: true,
      rejectionReason:
        role === "mentioned_only"
          ? "mentioned_only"
          : strength === "weak"
            ? "weak_evidence"
            : undefined,
    },
    locationCandidate.location,
    candidate.primaryDomain,
    Math.round(locationCandidate.score / 10),
  );
}

function sourceCountryFallbackEvidence(
  candidate: IntelligenceEventCandidate,
): WeightedEvidence | null {
  const location = resolveLocationByCountryCode(candidate.item.sourceCountry);
  if (!location) return null;
  return {
    role: "source_country_fallback",
    method: "source_country_fallback",
    locationLabel: location.label,
    countryCode: location.countryCode,
    evidenceText: "source country fallback is not marker eligible",
    strength: "weak",
    acceptedForMarker: false,
    rejectionReason: "fallback_only",
    location,
    priority: 0,
  };
}

function domainAllowsInstitutionFirst(
  candidate: IntelligenceEventCandidate,
  source: SourceDefinition,
): boolean {
  if (!source.institutionLocation) return false;
  if (source.markerLocationStrategy === "institution_location") return true;
  return (
    candidate.item.sourceBasis === "official_source" &&
    (candidate.primaryDomain === "official_statement" ||
      candidate.primaryDomain === "diplomacy" ||
      candidate.primaryDomain === "sanctions_law" ||
      candidate.primaryDomain === "international_org")
  );
}

function ambiguityRejects(top: WeightedEvidence, next?: WeightedEvidence): boolean {
  if (!next?.acceptedForMarker || !top.location || !next.location) return false;
  const topKey = top.location.countryCode ?? top.location.label;
  const nextKey = next.location.countryCode ?? next.location.label;
  if (topKey === nextKey) return false;
  if (top.role === "venue" || top.role === "official_actor") return false;
  if (
    top.method === "event_location_phrase" &&
    next.method === "headline_location_prefix"
  ) {
    return false;
  }
  return top.priority - next.priority <= 3;
}

function geoBasisFromEvidence(
  selected: WeightedEvidence,
  allEvidence: GeoEvidence[],
  domain: SourceFilterDomain,
): GeoBasis | undefined {
  if (!selected.location) return undefined;
  return {
    type: basisTypeForRole(selected.role),
    reason:
      selected.role === "official_actor" && domain === "official_statement"
        ? "ministry_statement"
        : reasonForDomain(domain),
    countryCode: selected.location.countryCode,
    region: selected.location.region,
    label: selected.location.label,
    resolutionMethod: selected.method,
    evidence: allEvidence.map((item) => item.evidenceText),
    evidenceDetails: allEvidence,
  };
}

function toPublicEvidence(item: WeightedEvidence): GeoEvidence {
  return {
    role: item.role,
    method: item.method,
    locationLabel: item.locationLabel,
    countryCode: item.countryCode,
    region: item.region,
    matchedText: item.matchedText,
    evidenceText: item.evidenceText,
    strength: item.strength,
    acceptedForMarker: item.acceptedForMarker,
    rejectionReason: item.rejectionReason,
  };
}

type ContextAnchorDecision = {
  anchor?: string;
  markerReason?: MarkerReason;
  noMarkerReason?: NoMarkerReason;
  markerEligibility?: MarkerEligibility;
};

function contextualAnchorDecision(
  candidate: IntelligenceEventCandidate,
  source: SourceDefinition,
): ContextAnchorDecision | null {
  const roles = candidate.entityRoles;
  if (!candidate.eventType || !roles) return null;

  if (source.markerLocationStrategy === "none") {
    return { markerEligibility: "feed_only", noMarkerReason: "source_entity_not_location" };
  }
  if (candidate.eventType === "analysis_or_opinion") {
    return { markerEligibility: "feed_only", noMarkerReason: "analysis_or_opinion_item" };
  }
  if (candidate.eventType === "local_crime" || candidate.eventType === "ordinary_rescue") {
    return { markerEligibility: "rejected", noMarkerReason: "local_crime_not_geopolitical" };
  }
  if (candidate.eventType === "sports") {
    return { markerEligibility: "rejected", noMarkerReason: "sports_or_non_relevant_domain" };
  }
  if (candidate.eventType === "lifestyle") {
    return { markerEligibility: "rejected", noMarkerReason: "non_relevant_lifestyle_item" };
  }

  if (
    candidate.eventType === "strategic_waterway" ||
    candidate.eventType === "maritime_security"
  ) {
    return roles.strategicLocation
      ? { anchor: roles.strategicLocation, markerReason: "strategic_topic_location" }
      : { markerEligibility: "needs_location", noMarkerReason: "no_explicit_location" };
  }

  if (candidate.eventType === "sanctions_impact") {
    return roles.impactLocation
      ? { anchor: roles.impactLocation, markerReason: "impact_location" }
      : { markerEligibility: "needs_location", noMarkerReason: "no_explicit_location" };
  }

  if (candidate.eventType === "health_outbreak" || candidate.eventType === "humanitarian_crisis") {
    if (roles.affectedLocation) {
      return { anchor: roles.affectedLocation, markerReason: "affected_location" };
    }
    if (roles.affectedCountry) {
      return {
        anchor: roles.affectedCountry,
        markerReason: candidate.contextReasons?.some((reason) => reason.includes("summary"))
          ? "summary_first_sentence_location"
          : "affected_country",
      };
    }
    return { markerEligibility: "needs_location", noMarkerReason: "no_explicit_location" };
  }

  if (candidate.eventType === "diplomatic_visit") {
    const destination = roles.destinationLocations?.[0];
    return destination
      ? { anchor: destination, markerReason: "destination_location" }
      : { markerEligibility: "needs_location", noMarkerReason: "no_explicit_location" };
  }

  if (
    candidate.eventType === "official_appointment" ||
    candidate.eventType === "government_appointment" ||
    candidate.eventType === "national_security_appointment" ||
    candidate.eventType === "defense_appointment" ||
    candidate.eventType === "diplomatic_appointment" ||
    candidate.eventType === "internal_government_decision"
  ) {
    if (roles.issuingCountry) {
      return {
        anchor: roles.issuingCountry,
        markerReason: "appointment_issuing_country",
      };
    }
    if (roles.issuingInstitution) {
      return {
        anchor: roles.issuingInstitution,
        markerReason: "issuing_institution_country",
      };
    }
    return {
      markerEligibility: "needs_location",
      noMarkerReason: roles.institution
        ? "institution_without_country_context"
        : "unresolved_issuing_country",
    };
  }

  if (candidate.eventType === "meeting" || candidate.eventType === "summit") {
    if (roles.meetingVenue) return { anchor: roles.meetingVenue, markerReason: "meeting_venue" };
    if (roles.officialCounterpartyCountry) {
      return {
        anchor: roles.officialCounterpartyCountry,
        markerReason: "official_counterparty_country",
      };
    }
    return {
      markerEligibility: candidate.eventType === "summit" ? "feed_only" : "needs_location",
      noMarkerReason: "unresolved_event_venue",
    };
  }

  if (
    candidate.eventType === "attack" ||
    candidate.eventType === "strike" ||
    candidate.eventType === "drone_strike" ||
    candidate.eventType === "missile_strike" ||
    candidate.eventType === "military_incident" ||
    candidate.eventType === "military_operation" ||
    candidate.eventType === "clash"
  ) {
    if (roles.affectedLocation) return { anchor: roles.affectedLocation, markerReason: "affected_location" };
    if (roles.eventLocation) return { anchor: roles.eventLocation, markerReason: "event_location" };
    if (roles.affectedCountry) return { anchor: roles.affectedCountry, markerReason: "affected_country" };
    if (roles.referencedEventLocation) return { anchor: roles.referencedEventLocation, markerReason: "event_location" };
    return { markerEligibility: "needs_location", noMarkerReason: "no_explicit_location" };
  }

  if (
    candidate.eventType === "condemnation" ||
    candidate.eventType === "warning" ||
    candidate.eventType === "official_statement" ||
    candidate.eventType === "diplomatic_message" ||
    candidate.eventType === "defense_policy" ||
    candidate.eventType === "sanctions_announcement" ||
    candidate.eventType === "legal_decision"
  ) {
    if (roles.affectedLocation) return { anchor: roles.affectedLocation, markerReason: "affected_location" };
    if (roles.affectedCountry) return { anchor: roles.affectedCountry, markerReason: "affected_country" };
    if (roles.issuingCountry) return { anchor: roles.issuingCountry, markerReason: "issuing_actor_country" };
    if (roles.issuingInstitution) {
      return { anchor: roles.issuingInstitution, markerReason: "issuing_institution_country" };
    }
    return { markerEligibility: "needs_location", noMarkerReason: "unresolved_official_actor" };
  }

  return null;
}

function methodForMarkerReason(reason: MarkerReason): GeoBasis["resolutionMethod"] {
  switch (reason) {
    case "issuing_actor_country":
    case "issuing_institution_country":
    case "official_actor_alias":
    case "country_demonym_role":
    case "institution_inherited_country":
    case "appointment_issuing_country":
      return "official_actor_phrase";
    case "destination_location":
    case "meeting_venue":
    case "official_counterparty_country":
      return "negotiation_location_phrase";
    case "title_location":
      return "headline_location_prefix";
    default:
      return "event_location_phrase";
  }
}

function roleForMarkerReason(reason: MarkerReason): GeoEvidenceRole {
  switch (reason) {
    case "issuing_actor_country":
    case "issuing_institution_country":
    case "official_actor_alias":
    case "country_demonym_role":
    case "institution_inherited_country":
    case "appointment_issuing_country":
      return "official_actor";
    case "destination_location":
    case "meeting_venue":
    case "official_counterparty_country":
      return "venue";
    default:
      return "event_location";
  }
}

function contextualGeoBasis(
  candidate: IntelligenceEventCandidate,
  location: ResolvedLocation,
  markerReason: MarkerReason,
  evidence: GeoEvidence[],
): GeoBasis {
  const method = methodForMarkerReason(markerReason) ?? "event_location_phrase";
  const contextEvidence = [
    `context marker: ${markerReason}`,
    ...(candidate.contextReasons ?? []).slice(0, 1),
  ];
  const compactEvidence = evidence.slice(0, 3);
  return {
    type: basisTypeForRole(roleForMarkerReason(markerReason)),
    reason: reasonForDomain(candidate.primaryDomain),
    countryCode: location.countryCode,
    region: location.region,
    label: location.label,
    resolutionMethod: method,
    evidence: [...contextEvidence, ...compactEvidence.map((item) => item.evidenceText)],
    evidenceDetails: [
      {
        role: roleForMarkerReason(markerReason),
        method,
        locationLabel: location.label,
        countryCode: location.countryCode,
        region: location.region,
        evidenceText: contextEvidence.join("; "),
        strength: "strong",
        acceptedForMarker: true,
      },
      ...compactEvidence,
    ],
  };
}

export function resolveGeoDecision(
  candidate: IntelligenceEventCandidate,
  source: SourceDefinition,
): GeoDecision {
  const scanText = textForGeoResolution(candidate);
  const evidence: WeightedEvidence[] = [];

  if (domainAllowsInstitutionFirst(candidate, source)) {
    const institution = institutionEvidence(source, candidate.primaryDomain);
    if (institution) evidence.push(institution);
  }

  const payload = payloadEvidence(candidate, source);
  if (payload) evidence.push(payload);

  const fallback = sourceCountryFallbackEvidence(candidate);
  if (fallback && source.markerLocationStrategy !== "none") evidence.push(fallback);

  let publicEvidence: GeoEvidence[] = evidence.map(toPublicEvidence);

  const contextDecision = contextualAnchorDecision(candidate, source);
  if (contextDecision) {
    if (contextDecision.anchor && contextDecision.markerReason) {
      const location = resolveLocationByAnchor(contextDecision.anchor);
      if (location) {
        return {
          markerEligibility: "eligible",
          location,
          geoBasis: contextualGeoBasis(
            candidate,
            location,
            contextDecision.markerReason,
            publicEvidence,
          ),
          evidence: publicEvidence,
          markerAnchor: contextDecision.anchor,
          markerReason: contextDecision.markerReason,
        };
      }
      return {
        markerEligibility: "needs_location",
        geoBasis:
          publicEvidence.length > 0
            ? {
                type: "mentioned_country",
                reason: "fallback",
                evidence: publicEvidence.map((item) => item.evidenceText),
                evidenceDetails: publicEvidence,
              }
            : undefined,
        evidence: publicEvidence,
        markerAnchor: contextDecision.anchor,
        noMarkerReason: "no_explicit_location",
      };
    }

    if (contextDecision.markerEligibility) {
      return {
        markerEligibility: contextDecision.markerEligibility,
        geoBasis:
          publicEvidence.length > 0
            ? {
                type: "mentioned_country",
                reason: "fallback",
                evidence: publicEvidence.map((item) => item.evidenceText),
                evidenceDetails: publicEvidence,
              }
            : undefined,
        evidence: publicEvidence,
        noMarkerReason: contextDecision.noMarkerReason,
      };
    }
  }

  if (candidate.item.locationResolutionCandidates === undefined) {
    candidate.item.locationResolutionCandidates =
      findLocationResolutionCandidates(scanText);
  }
  for (const locationCandidate of candidate.item.locationResolutionCandidates) {
    evidence.push(locationCandidateEvidence(candidate, locationCandidate));
  }
  publicEvidence = evidence.map(toPublicEvidence);

  const accepted = evidence
    .filter((item) => item.acceptedForMarker && item.location)
    .sort((a, b) => b.priority - a.priority);

  const selected = accepted[0];
  if (!selected) {
    return {
      markerEligibility:
        source.markerLocationStrategy === "none" ? "feed_only" : "needs_location",
      geoBasis:
        publicEvidence.length > 0
          ? {
              type: "mentioned_country",
              reason: "fallback",
              resolutionMethod: fallback?.method,
              evidence: publicEvidence.map((item) => item.evidenceText),
              evidenceDetails: publicEvidence,
            }
          : undefined,
      evidence: publicEvidence,
      noMarkerReason:
        source.markerLocationStrategy === "none"
          ? "source_entity_not_location"
          : "no_explicit_location",
    };
  }

  if (ambiguityRejects(selected, accepted[1])) {
    const ambiguousEvidence = publicEvidence.map((item) =>
      item.acceptedForMarker
        ? {
            ...item,
            acceptedForMarker: false,
            rejectionReason: "ambiguous_candidates" as const,
          }
        : item,
    );
    return {
      markerEligibility: "needs_location",
      geoBasis: {
        type: "mentioned_country",
        reason: "fallback",
        evidence: ambiguousEvidence.map((item) => item.evidenceText),
        evidenceDetails: ambiguousEvidence,
      },
      evidence: ambiguousEvidence,
      noMarkerReason: "ambiguous_competing_locations",
    };
  }

  return {
    markerEligibility: "eligible",
    location: selected.location,
    geoBasis: geoBasisFromEvidence(
      selected,
      publicEvidence,
      candidate.primaryDomain,
    ),
    evidence: publicEvidence,
    markerAnchor: selected.location?.label,
  };
}
