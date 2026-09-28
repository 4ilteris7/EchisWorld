import { candidateSourceDefinitions } from "@/data/sources/sourceDefinitions";
import { expansionSourceIds } from "@/data/sources/sourceExpansion";
import type {
  CollectionMethod,
  SourceDefinition,
  SourceStatus,
  SourceType,
} from "./sourceIntelligenceTypes";

const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  "United States": "US",
  Turkey: "TR",
  "Türkiye": "TR",
  Belgium: "BE",
  France: "FR",
  Germany: "DE",
  "United Kingdom": "GB",
  Russia: "RU",
  Australia: "AU",
  Israel: "IL",
  "Saudi Arabia": "SA",
  // ── New country codes added for expanded RSS source coverage ──
  "United Arab Emirates": "AE",
  Iran: "IR",
  Syria: "SY",
  Yemen: "YE",
  Qatar: "QA",
  Vietnam: "VN",
  China: "CN",
  Azerbaijan: "AZ",
  Italy: "IT",
  Serbia: "RS",
  Greece: "GR",
  Cyprus: "CY",
  Libya: "LY",
  Uzbekistan: "UZ",
};

export const SOURCE_INTELLIGENCE_DEFAULT_SOURCE_IDS = [
  // ── API sources ──────────────────────────────────────────────────────────
  "currents-geopolitical",
  "newsdata-geopolitical",
  "worldnews-geopolitical",
  "freenews-geopolitical",
  "finlight-geopolitical",
  "gdelt-geopolitical",
  "guardian-world",
  // ── Crisis / humanitarian ────────────────────────────────────────────────
  "reliefweb-crises",
  // ── Turkish sources ──────────────────────────────────────────────────────
  "aa-en-live",
  "trt-haber-turkiye",
  "trt-haber-dunya-feed",
  "trt-haber-dunya",
  "bbc-turkce",
  "dw-turkce",
  // ── Middle East / Gulf ───────────────────────────────────────────────────
  "aljazeera-middle-east",
  "wam-uae-news",
  "wam-world",
  "qna-en",
  "arabnews-cat1",
  "arabnews-cat2",
  // ── Iran ─────────────────────────────────────────────────────────────────
  "irna-en",
  "mehr-politics",
  "mehr-world",
  "mehr-iran",
  "mehr-economy",
  "mehr-society",
  "mehr-culture",
  "mehr-science",
  "mehr-special",
  "presstv-headlines",
  "presstv-iran",
  "presstv-middle-east",
  "presstv-world",
  "presstv-politics",
  "presstv-us-europe",
  // ── Levant / conflict zone ───────────────────────────────────────────────
  "sana-en",
  "sana-tr",
  "saba-politics",
  "saba-local",
  "saba-arab",
  "saba-international",
  "saba-economy",
  "saba-military",
  "times-of-israel",
  "jpost-headlines",
  "jpost-israel",
  "jpost-gaza",
  "jpost-iran",
  // ── Asia-Pacific ─────────────────────────────────────────────────────────
  "vna-politics",
  "vna-security",
  "xinhua-china",
  "xinhua-world",
  "abc-australia",
  // ── Russia / Eurasia ─────────────────────────────────────────────────────
  "tass-world",
  "azertag-politics",
  "azertag-official",
  // ── Europe ───────────────────────────────────────────────────────────────
  "euronews-world",
  "skynews-world",
  "skynews-uk",
  "skynews-us",
  "skynews-politics",
  "skynews-home",
  "france24-europe",
  "france24-africa",
  "france24-middle-east",
  "france24-americas",
  "france24-asia-pacific",
  "ansa-en",
  "tanjug-politika",
  "ertnews-gr",
  "cyprus-mail",
  // ── Balkans ───────────────────────────────────────────────────────────────
  "balkan-albania",
  "balkan-bosnia",
  "balkan-croatia",
  "balkan-bulgaria",
  "balkan-greece",
  "balkan-kosovo",
  "balkan-macedonia",
  "balkan-moldova",
  "balkan-montenegro",
  "balkan-serbia",
  // ── Africa / North Africa ─────────────────────────────────────────────────
  "lana-en",
  "allafrica-latest",
  "daily-maverick",
  "premium-times-ng",
  "humangle",
  "african-arguments",
  // ── Central Asia ──────────────────────────────────────────────────────────
  "gazetauz-politics",
  "gazetauz-society",
  // ── Latin America ─────────────────────────────────────────────────────────
  "insight-crime",
  "mercopress",
  // ── South / East Asia ─────────────────────────────────────────────────────
  "yonhap",
  "dawn",
  // ── Defense ───────────────────────────────────────────────────────────────
  "defense-news-global",
  "dod-news",
  // ── Citizen media / global ────────────────────────────────────────────────
  "globalvoices-main",
  "globalvoices-filtered",
  // ── Africa English-language expansion (afrika_ingilizce_haber_rss_feedleri.md) ──
  "bbc-africa",
  "africanews",
  "lemonde-afrique-en",
  "north-africa-post",
  "unep",
  "morocco-world-news",
  "hespress-en",
  "meed-algeria",
  "meed-tunisia",
  "libya-observer",
  "libya-review",
  "libya-security-monitor",
  "meed-libya",
  "egypt-independent",
  "daily-news-egypt",
  "egyptian-streets",
  "cairoscene",
  "scoop-empire",
  "egyptian-gazette",
  "enterprise-egypt",
  "dabanga-sudan",
  "sudan-tribune",
  "ayin-network",
  "radio-tamazuj",
  "north-africa-post-mauritania",
  "meed-mauritania",
  "addis-standard",
  "capital-ethiopia",
  "ethiopia-observer",
  "kenya-news-agency",
  "nairobi-wire",
  "kahawatungu",
  "the-elephant",
  "independent-uganda",
  "nile-post",
  "chimp-reports",
  "kt-press",
  "new-times-rwanda",
  "tanzania-times",
  "garowe-online",
  "shabelle-media",
  "horn-observer",
  "eye-radio",
  "talk-of-juba",
  "guardian-nigeria",
  "thecable",
  "punch-nigeria",
  "businessday-nigeria",
  "sahara-reporters",
  "ghana-business-news",
  "modern-ghana",
  "myjoyonline",
  "citi-newsroom",
  "togo-first",
  "frontpage-africa",
  "the-point-gambia",
  "sierraloaded",
  "cameroon-concord",
  "groundup",
  "the-south-african",
  "businesstech",
  "techcentral",
  "new-zimbabwe",
  "newsday-zimbabwe",
  "zimbabwe-situation",
  "lusaka-times",
  "mwebantu",
  "nyasa-times",
  "malawi24",
  "mmegi",
  "the-namibian",
  "namibia-economist",
  "club-of-mozambique",
  "zitamar",
  "mozambique-mining-journal",
  "mauritius-times",
  ...expansionSourceIds,
] as const;

function sourceStatus(status: string): SourceStatus {
  switch (status) {
    case "rejected":
      return "disabled";
    case "candidate_test":
      // The full manifest has been running in the production collector for a
      // long time. "candidate_test" is retained only as legacy source metadata;
      // it must no longer make live Sources rows look like test fixtures.
      return "active";
    default:
      return "candidate";
  }
}

function sourceType(source: (typeof candidateSourceDefinitions)[number]): SourceType {
  // ── API aggregators ──────────────────────────────────────────────────────
  if (source.id.startsWith("currents-")) return "global_news";
  if (source.id.startsWith("newsdata-")) return "global_news";
  if (source.id.startsWith("worldnews-")) return "global_news";
  if (source.id.startsWith("freenews-")) return "global_news";
  if (source.id.startsWith("finlight-")) return "global_news";
  if (source.id.startsWith("gdelt-")) return "aggregator";
  if (source.id.startsWith("guardian-")) return "global_news";
  if (source.id.startsWith("reliefweb-")) return "crisis_humanitarian";
  // ── State wire agencies ──────────────────────────────────────────────────
  if (source.id.startsWith("irna-")) return "wire_agency";
  if (source.id.startsWith("mehr-")) return "wire_agency";
  if (source.id.startsWith("presstv-")) return "wire_agency";
  if (source.id.startsWith("tass-")) return "wire_agency";
  if (source.id.startsWith("xinhua-")) return "wire_agency";
  if (source.id.startsWith("ansa-")) return "wire_agency";
  if (source.id.startsWith("tanjug-")) return "wire_agency";
  // ── Official government agencies ─────────────────────────────────────────
  if (source.id.startsWith("wam-")) return "official_government";
  if (source.id.startsWith("sana-")) return "official_government";
  if (source.id.startsWith("saba-")) return "official_government";
  if (source.id.startsWith("qna-")) return "official_government";
  if (source.id.startsWith("vna-")) return "official_government";
  if (source.id.startsWith("azertag-")) return "official_government";
  if (source.id.startsWith("lana-")) return "official_government";
  if (source.sourceStatus === "official_government" || source.sourceStatus === "official_feed") {
    return "official_government";
  }
  // ── Regional / investigative ─────────────────────────────────────────────
  if (source.id.startsWith("balkan-")) return "regional_news";
  if (source.id.startsWith("ertnews-")) return "regional_news";
  if (source.id.startsWith("cyprus-")) return "regional_news";
  if (source.id.startsWith("gazetauz-")) return "regional_news";
  if (source.id.startsWith("globalvoices-")) return "global_news";
  if (source.id.startsWith("jpost-")) return "global_news";
  if (source.sourceProfile === "conflict_crisis") return "regional_news";
  return source.language === "tr" ? "regional_news" : "global_news";
}

function collectionMethod(
  source: (typeof candidateSourceDefinitions)[number],
): CollectionMethod {
  if (source.id.startsWith("currents-")) return "api";
  if (source.id.startsWith("newsdata-")) return "api";
  if (source.id.startsWith("worldnews-")) return "api";
  if (source.id.startsWith("freenews-")) return "api";
  if (source.id.startsWith("finlight-")) return "api";
  if (source.id.startsWith("gdelt-")) return "aggregator_api";
  if (source.accessType === "rss") return "rss";
  if (source.accessType === "api") return "api";
  if (source.accessType === "manual") return "script_import";
  return "dataset";
}

function endpointFor(
  source: (typeof candidateSourceDefinitions)[number],
  method: CollectionMethod,
): string | undefined {
  if (source.id.startsWith("currents-")) return "/api/sources/currents";
  if (source.id.startsWith("newsdata-")) return "/api/sources/newsdata";
  if (source.id.startsWith("worldnews-")) return "/api/sources/worldnews";
  if (source.id.startsWith("freenews-")) return "/api/sources/freenews";
  if (source.id.startsWith("finlight-")) return "/api/sources/finlight";
  if (source.id.startsWith("gdelt-")) return "/api/sources/gdelt";
  if (method === "rss") {
    return `/api/sources/rss-preview?sourceId=${encodeURIComponent(source.id)}`;
  }
  return undefined;
}

export const sourceRegistry: SourceDefinition[] = candidateSourceDefinitions.map(
  (source) => {
    const method = collectionMethod(source);
    const institutionCountry = source.sourceLocation?.country;
    return {
      id: source.id,
      name: source.name,
      sourceType: sourceType(source),
      collectionMethod: method,
      countryCode: institutionCountry
        ? COUNTRY_CODE_BY_NAME[institutionCountry]
        : undefined,
      language: source.language,
      endpoint: endpointFor(source, method),
      feedUrl: source.candidateFeedUrl,
      sourceStatus: sourceStatus(source.candidateStatus),
      institutionLocation: source.sourceLocation
        ? {
            countryCode:
              COUNTRY_CODE_BY_NAME[source.sourceLocation.country] ?? "",
            city: source.sourceLocation.label,
            lat: source.sourceLocation.lat,
            lon: source.sourceLocation.lng,
            label: source.sourceLocation.label,
          }
        : undefined,
      markerLocationStrategy:
        source.markerLocationStrategy === "source_location"
          ? "institution_location"
          : source.markerLocationStrategy === "item_location"
            ? "item_location"
            : "none",
      legacyCategory: source.category,
      legacyRegionScope: source.regionScope,
      origin: "built_in",
    };
  },
);

export const activeSourceRegistry = sourceRegistry.filter((source) =>
  SOURCE_INTELLIGENCE_DEFAULT_SOURCE_IDS.includes(
    source.id as (typeof SOURCE_INTELLIGENCE_DEFAULT_SOURCE_IDS)[number],
  ),
);

// O(1) lookup map — built once at module load so repeated calls from
// buildIntelligenceEventCandidates and sourceItemsToMarkers don't scan
// the full registry array on every item.
const _sourceRegistryMap = new Map<string, SourceDefinition>(
  sourceRegistry.map((s) => [s.id, s]),
);

export function getSourceDefinition(
  sourceId: string,
): SourceDefinition | undefined {
  return _sourceRegistryMap.get(sourceId);
}
