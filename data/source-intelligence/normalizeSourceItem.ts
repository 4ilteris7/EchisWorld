import type {
  ExtractionMethod,
  NormalizedSourceItem,
  RawSourceItem,
  SourceBasis,
  SourceDefinition,
  VerificationStatus,
} from "./sourceIntelligenceTypes";

type LegacyLocationHint = {
  lat?: unknown;
  lng?: unknown;
  locationName?: unknown;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : undefined;
}

function inferSourceBasis(
  raw: RawSourceItem,
  source: SourceDefinition,
): SourceBasis {
  const legacy = stringValue(raw.sourceBasis);
  if (legacy === "official_source" || legacy === "single_official_source") {
    return "official_source";
  }
  if (legacy === "multiple_public_sources" || legacy === "multi_source_reference") {
    return "multi_source";
  }
  if (source.sourceType === "official_government" || source.sourceType === "intergovernmental_org") {
    return "official_source";
  }
  if (source.collectionMethod === "dataset") return "dataset_record";
  if (source.collectionMethod === "scraping") return "scraped_candidate";
  return "source_reported";
}

function inferVerificationStatus(
  raw: RawSourceItem,
  source: SourceDefinition,
): VerificationStatus {
  const legacy = stringValue(raw.verificationStatus);
  if (
    legacy === "official" ||
    legacy === "official_entry" ||
    legacy === "official_statement"
  ) {
    return "official";
  }
  if (legacy === "cross_source_matched" || legacy === "multi_source_reference") {
    return "cross_source_matched";
  }
  if (source.sourceType === "official_government" || source.sourceType === "intergovernmental_org") {
    return "official";
  }
  return "reported";
}

function inferExtractionMethod(
  raw: RawSourceItem,
  source: SourceDefinition,
): ExtractionMethod {
  const legacy = stringValue(raw.extractionMethod);
  if (legacy === "rss_summary" || legacy === "rss_feed") return "rss_summary";
  if (legacy === "api_result" || legacy === "official_json") return "api_payload";
  if (legacy === "scraped_page") return "scraped_page";
  if (legacy === "dataset_record") return "dataset_record";
  if (legacy === "script_import" || legacy === "manual_sample") return "script_import";

  switch (source.collectionMethod) {
    case "rss":
      return "rss_summary";
    case "api":
    case "aggregator_api":
    case "official_page":
      return "api_payload";
    case "scraping":
      return "scraped_page";
    case "script_import":
      return "script_import";
    case "dataset":
      return "dataset_record";
  }
}

function locationHint(raw: RawSourceItem): NormalizedSourceItem["locationHint"] {
  const hint = raw.sourceLocationForMarker as LegacyLocationHint | undefined;
  if (!hint) return undefined;
  const lat = typeof hint.lat === "number" ? hint.lat : undefined;
  const lng = typeof hint.lng === "number" ? hint.lng : undefined;
  const label = stringValue(hint.locationName);
  if (lat === undefined || lng === undefined || !label) return undefined;
  return {
    latitude: lat,
    longitude: lng,
    label,
  };
}

export function normalizeSourceItem(
  raw: RawSourceItem,
  source: SourceDefinition,
): NormalizedSourceItem {
  const mentionedCountries = stringArray(raw.relatedCountries);
  const mentionedRegions = stringArray(raw.relatedRegions);
  const title = stringValue(raw.title) ?? "Untitled source item";
  const summary = stringValue(raw.summary);
  const collectedAt =
    stringValue(raw.collectedAt) ?? new Date().toISOString();

  return {
    id: stringValue(raw.id) ?? `${source.id}::${title}::${collectedAt}`,
    sourceId: stringValue(raw.sourceId) ?? source.id,
    sourceName: stringValue(raw.sourceName) ?? source.name,
    sourceType: source.sourceType,
    collectionMethod: source.collectionMethod,
    title,
    summary,
    bodyText: stringValue(raw.bodyText),
    url: stringValue(raw.url),
    language: stringValue(raw.sourceLanguage) ?? source.language,
    publishedAt: stringValue(raw.publishedAt),
    collectedAt,
    sourceCountry: source.countryCode,
    eventCountry: mentionedCountries?.[0],
    actorCountries: mentionedCountries,
    mentionedCountries,
    mentionedRegions,
    institutions: stringArray(raw.institutions),
    persons: stringArray(raw.persons),
    organizations: stringArray(raw.organizations),
    sourceBasis: inferSourceBasis(raw, source),
    verificationStatus: inferVerificationStatus(raw, source),
    extractionMethod: inferExtractionMethod(raw, source),
    locationHint: locationHint(raw),
    legacyCategory: stringValue(raw.category) ?? source.legacyCategory,
  };
}
