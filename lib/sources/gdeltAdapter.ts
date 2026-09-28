import type {
  NormalizedSourceItem,
  SourceDefinition,
} from "@/data/sources/sourceTypes";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_TITLE_LENGTH = 300;

const GDELT_API_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_HTTP_FALLBACK_BASE_URL = "http://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_CATEGORY_LABEL = "Geopolitical Events";
const GDELT_QUERY =
  "war OR conflict OR ceasefire OR airstrike OR offensive OR invasion OR " +
  "diplomacy OR sanctions OR summit OR treaty OR negotiations OR ambassador OR " +
  "envoy OR military OR troops OR defense OR weapons OR NATO OR mobilization OR " +
  "coup OR warship OR nuclear OR ballistic OR Ukraine OR Russia OR Iran OR " +
  "Israel OR Gaza OR Lebanon OR Taiwan OR China";

// ---------------------------------------------------------------------------
// Country lookup tables
// ---------------------------------------------------------------------------

const FIPS_TO_COUNTRY: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", AG: "Algeria", AO: "Angola",
  AR: "Argentina", AM: "Armenia", AS: "Australia", AU: "Austria",
  AJ: "Azerbaijan", BA: "Bahrain", BG: "Bangladesh", BO: "Belarus",
  BE: "Belgium", BR: "Brazil", BU: "Bulgaria", BM: "Burma (Myanmar)",
  BY: "Burundi", CB: "Cambodia", CM: "Cameroon", CA: "Canada",
  CD: "Chad", CI: "Chile", CH: "China", CO: "Colombia",
  CG: "Congo (DRC)", CF: "Congo (Republic)", HR: "Croatia",
  CU: "Cuba", CY: "Cyprus", EZ: "Czechia", DA: "Denmark",
  DJ: "Djibouti", DR: "Dominican Republic", EC: "Ecuador",
  EG: "Egypt", ES: "El Salvador", ER: "Eritrea", EN: "Estonia",
  ET: "Ethiopia", FI: "Finland", FR: "France", GA: "Gambia",
  GG: "Georgia", GM: "Germany", GH: "Ghana", GR: "Greece",
  GT: "Guatemala", GV: "Guinea", HA: "Haiti", HO: "Honduras",
  HU: "Hungary", IN: "India", ID: "Indonesia", IR: "Iran",
  IZ: "Iraq", EI: "Ireland", IS: "Israel", IT: "Italy",
  JA: "Japan", JO: "Jordan", KZ: "Kazakhstan", KE: "Kenya",
  KN: "North Korea", KS: "South Korea", KU: "Kuwait",
  KG: "Kyrgyzstan", LA: "Laos", LG: "Latvia", LE: "Lebanon",
  LY: "Libya", LH: "Lithuania", LU: "Luxembourg",
  MK: "North Macedonia", MA: "Madagascar", ML: "Mali",
  MO: "Morocco", MZ: "Mozambique",
  NP: "Nepal", NL: "Netherlands", NZ: "New Zealand",
  NG: "Niger", NI: "Nigeria", NO: "Norway", MU: "Oman",
  PK: "Pakistan", PM: "Panama", PE: "Peru", RP: "Philippines",
  PL: "Poland", PO: "Portugal", QA: "Qatar", RO: "Romania",
  RS: "Russia", RW: "Rwanda", SA: "Saudi Arabia", SG: "Senegal",
  RI: "Serbia", SL: "Sierra Leone", SN: "Singapore",
  LO: "Slovakia", SI: "Slovenia", SO: "Somalia",
  SF: "South Africa", SP: "Spain", CE: "Sri Lanka",
  SU: "Sudan", OD: "South Sudan", SW: "Sweden",
  SZ: "Switzerland", SY: "Syria", TW: "Taiwan", TI: "Tajikistan",
  TZ: "Tanzania", TH: "Thailand", TO: "Togo", TS: "Tunisia",
  TU: "Turkey", TX: "Turkmenistan", UG: "Uganda", UP: "Ukraine",
  AE: "UAE", UK: "United Kingdom", US: "United States",
  UZ: "Uzbekistan", VE: "Venezuela", VM: "Vietnam",
  YM: "Yemen", ZA: "Zambia", ZI: "Zimbabwe",
};

const FIPS_TO_COORDS: Record<string, { lat: number; lng: number }> = {
  AF: { lat: 33.93, lng: 67.71 }, AL: { lat: 41.15, lng: 20.17 },
  AG: { lat: 28.03, lng: 1.66 }, AO: { lat: -11.2, lng: 17.87 },
  AR: { lat: -38.42, lng: -63.62 }, AM: { lat: 40.07, lng: 45.04 },
  AS: { lat: -25.27, lng: 133.78 }, AU: { lat: 47.52, lng: 14.55 },
  AJ: { lat: 40.14, lng: 47.58 }, BA: { lat: 26.0, lng: 50.55 },
  BG: { lat: 23.68, lng: 90.36 }, BO: { lat: 53.71, lng: 27.95 },
  BE: { lat: 50.50, lng: 4.47 }, BR: { lat: -14.24, lng: -51.93 },
  BU: { lat: 42.73, lng: 25.49 }, BM: { lat: 21.92, lng: 95.96 },
  BY: { lat: -3.37, lng: 29.92 }, CB: { lat: 12.57, lng: 104.99 },
  CM: { lat: 7.37, lng: 12.35 }, CA: { lat: 56.13, lng: -106.35 },
  CD: { lat: 15.45, lng: 18.73 }, CI: { lat: -35.68, lng: -71.54 },
  CH: { lat: 35.86, lng: 104.19 }, CO: { lat: 4.57, lng: -74.3 },
  CG: { lat: -4.04, lng: 21.76 }, CF: { lat: -0.23, lng: 15.83 },
  HR: { lat: 45.10, lng: 15.20 }, CU: { lat: 21.52, lng: -77.78 },
  CY: { lat: 35.13, lng: 33.43 }, EZ: { lat: 49.82, lng: 15.47 },
  DA: { lat: 56.26, lng: 9.50 }, DJ: { lat: 11.83, lng: 42.59 },
  DR: { lat: 18.74, lng: -70.16 }, EC: { lat: -1.83, lng: -78.18 },
  EG: { lat: 26.82, lng: 30.8 }, ES: { lat: 13.79, lng: -88.9 },
  ER: { lat: 15.18, lng: 39.78 }, EN: { lat: 58.60, lng: 25.01 },
  ET: { lat: 9.15, lng: 40.49 }, FI: { lat: 61.92, lng: 25.75 },
  FR: { lat: 46.23, lng: 2.21 }, GA: { lat: 13.44, lng: -15.31 },
  GG: { lat: 42.32, lng: 43.36 }, GM: { lat: 51.17, lng: 10.45 },
  GH: { lat: 7.95, lng: -1.02 }, GR: { lat: 39.07, lng: 21.82 },
  GT: { lat: 15.78, lng: -90.23 }, GV: { lat: 9.95, lng: -11.49 },
  HA: { lat: 18.97, lng: -72.29 }, HO: { lat: 15.20, lng: -86.24 },
  HU: { lat: 47.16, lng: 19.50 }, IN: { lat: 20.59, lng: 78.96 },
  ID: { lat: -0.79, lng: 113.92 }, IR: { lat: 32.43, lng: 53.69 },
  IZ: { lat: 33.22, lng: 43.68 }, EI: { lat: 53.41, lng: -8.24 },
  IS: { lat: 31.05, lng: 34.85 }, IT: { lat: 41.87, lng: 12.57 },
  JA: { lat: 36.20, lng: 138.25 }, JO: { lat: 30.59, lng: 36.24 },
  KZ: { lat: 48.02, lng: 66.92 }, KE: { lat: -0.02, lng: 37.91 },
  KN: { lat: 40.34, lng: 127.51 }, KS: { lat: 35.91, lng: 127.77 },
  KU: { lat: 29.31, lng: 47.48 }, KG: { lat: 41.20, lng: 74.76 },
  LA: { lat: 19.86, lng: 102.5 }, LG: { lat: 56.88, lng: 24.60 },
  LE: { lat: 33.85, lng: 35.86 }, LY: { lat: 26.34, lng: 17.23 },
  LH: { lat: 55.17, lng: 23.88 }, LU: { lat: 49.82, lng: 6.13 },
  MK: { lat: 41.61, lng: 21.75 }, MA: { lat: -18.77, lng: 46.87 },
  ML: { lat: 17.57, lng: -3.99 }, MO: { lat: 31.79, lng: -7.09 },
  MZ: { lat: -18.67, lng: 35.53 }, NP: { lat: 28.39, lng: 84.12 },
  NL: { lat: 52.13, lng: 5.29 }, NZ: { lat: -40.90, lng: 174.89 },
  NG: { lat: 17.61, lng: 8.08 }, NI: { lat: 9.08, lng: 8.68 },
  NO: { lat: 60.47, lng: 8.47 }, MU: { lat: 21.51, lng: 55.92 },
  PK: { lat: 30.38, lng: 69.35 }, PM: { lat: 8.54, lng: -80.78 },
  PE: { lat: -9.19, lng: -75.02 }, RP: { lat: 12.88, lng: 121.77 },
  PL: { lat: 51.92, lng: 19.15 }, PO: { lat: 39.40, lng: -8.22 },
  QA: { lat: 25.35, lng: 51.18 }, RO: { lat: 45.94, lng: 24.97 },
  RS: { lat: 61.52, lng: 105.32 }, RW: { lat: -1.94, lng: 29.87 },
  SA: { lat: 23.89, lng: 45.08 }, SG: { lat: 14.50, lng: -14.45 },
  RI: { lat: 44.02, lng: 21.01 }, SL: { lat: 8.46, lng: -11.78 },
  SN: { lat: 1.35, lng: 103.82 }, LO: { lat: 48.67, lng: 19.70 },
  SI: { lat: 46.15, lng: 14.99 }, SO: { lat: 5.15, lng: 46.20 },
  SF: { lat: -30.56, lng: 22.94 }, SP: { lat: 40.46, lng: -3.75 },
  CE: { lat: 7.87, lng: 80.77 }, SU: { lat: 12.86, lng: 30.22 },
  OD: { lat: 6.88, lng: 31.31 }, SW: { lat: 60.13, lng: 18.64 },
  SZ: { lat: 46.82, lng: 8.23 }, SY: { lat: 34.80, lng: 38.99 },
  TW: { lat: 23.70, lng: 120.96 }, TI: { lat: 38.86, lng: 71.28 },
  TZ: { lat: -6.37, lng: 34.89 }, TH: { lat: 15.87, lng: 100.99 },
  TO: { lat: 8.62, lng: 0.82 }, TS: { lat: 33.89, lng: 9.54 },
  TU: { lat: 38.96, lng: 35.24 }, TX: { lat: 38.97, lng: 59.56 },
  UG: { lat: 1.37, lng: 32.29 }, UP: { lat: 48.38, lng: 31.17 },
  AE: { lat: 23.42, lng: 53.85 }, UK: { lat: 55.38, lng: -3.44 },
  US: { lat: 37.09, lng: -95.71 }, UZ: { lat: 41.38, lng: 64.59 },
  VE: { lat: 6.42, lng: -66.59 }, VM: { lat: 14.06, lng: 108.28 },
  YM: { lat: 15.55, lng: 48.52 }, ZA: { lat: -13.13, lng: 27.85 },
  ZI: { lat: -19.02, lng: 29.15 },
};

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

interface GdeltApiResponse {
  articles?: GdeltArticle[];
}

function normalizeSourceLanguage(language: string | undefined): SourceDefinition["language"] {
  const normalized = (language ?? "").trim().toLowerCase();
  switch (normalized) {
    case "turkish":
    case "tr":
      return "tr";
    case "arabic":
    case "ar":
      return "ar";
    case "french":
    case "fr":
      return "fr";
    case "spanish":
    case "es":
      return "es";
    case "russian":
    case "ru":
      return "ru";
    case "german":
    case "de":
      return "de";
    default:
      return "en";
  }
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function parseGdeltDate(seendate: string): string {
  if (!seendate || seendate.length < 15) return "";
  try {
    const iso =
      `${seendate.slice(0, 4)}-${seendate.slice(4, 6)}-${seendate.slice(6, 8)}` +
      `T${seendate.slice(9, 11)}:${seendate.slice(11, 13)}:${seendate.slice(13, 15)}Z`;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// URL builder (exported for tests / gdelt route)
// ---------------------------------------------------------------------------

export function buildGdeltUrl(
  queryString: string,
  timespan = "24h",
  maxRecords = 25,
): string {
  const params = new URLSearchParams({
    query: queryString,
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(maxRecords, 250)),
    timespan: timespan,
    sort: "DateDesc",
  });
  return `${GDELT_API_BASE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

function buildGdeltHttpFallbackUrl(
  queryString: string,
  timespan = "24h",
  maxRecords = 25,
): string {
  return buildGdeltUrl(queryString, timespan, maxRecords).replace(
    GDELT_API_BASE_URL,
    GDELT_HTTP_FALLBACK_BASE_URL,
  );
}

function isTlsFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage = typeof cause?.message === "string" ? cause.message : "";
  return (
    causeCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    causeCode === "SELF_SIGNED_CERT_IN_CHAIN" ||
    causeMessage.includes("certificate")
  );
}

function sourceFetchError(error: unknown): Error {
  if (error instanceof Error) {
    const cause = error.cause as { code?: unknown } | undefined;
    const causeCode = typeof cause?.code === "string" ? cause.code : "";
    if (causeCode === "EACCES") return new Error("network_access_denied");
    if (causeCode === "ETIMEDOUT") return new Error("timeout");
    if (causeCode === "ECONNRESET") return new Error("network_connection_reset");
    if (isTlsFetchFailure(error)) return new Error("tls_certificate_error");
    if (error.message === "fetch failed") return new Error("network_fetch_failed");
    return error;
  }
  return new Error("network_fetch_failed");
}

async function fetchGdeltApi(
  url: string,
  timeoutMs: number,
): Promise<GdeltApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "EchisWorld/1.0",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      const detail = text.trim().replace(/\s+/g, " ").slice(0, 160);
      throw new Error(
        `upstream_${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    try {
      return JSON.parse(text) as GdeltApiResponse;
    } catch {
      throw new Error("parse_failed");
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGdeltArticles(
  source: SourceDefinition,
  timespan = "24h",
): Promise<NormalizedSourceItem[]> {
  const maxRecords = 50;
  const httpsUrl = buildGdeltUrl(GDELT_QUERY, timespan, maxRecords);
  let data: GdeltApiResponse;

  try {
    data = await fetchGdeltApi(httpsUrl, FETCH_TIMEOUT_MS);
  } catch (error) {
    if (!isTlsFetchFailure(error)) throw sourceFetchError(error);
    try {
      data = await fetchGdeltApi(
        buildGdeltHttpFallbackUrl(GDELT_QUERY, timespan, maxRecords),
        FETCH_TIMEOUT_MS,
      );
    } catch (fallbackError) {
      throw sourceFetchError(fallbackError);
    }
  }

  const seen = new Set<string>();
  const allArticles: (GdeltArticle & { _category: string })[] = [];
  for (const article of data.articles ?? []) {
    if (article.url && !seen.has(article.url)) {
      seen.add(article.url);
      allArticles.push({ ...article, _category: GDELT_CATEGORY_LABEL });
    }
  }

  const collectedAt = new Date().toISOString();
  const items: NormalizedSourceItem[] = [];

  for (const article of allArticles) {
    if (!article.title || !article.url) continue;

    const title = clamp(article.title.trim(), MAX_TITLE_LENGTH);
    const publishedAt = parseGdeltDate(article.seendate);
    const fipsCode = (article.sourcecountry || "").toUpperCase();
    const countryName = FIPS_TO_COUNTRY[fipsCode];
    const coords = FIPS_TO_COORDS[fipsCode];
    // relatedCountries intentionally left empty: GDELT's `sourcecountry` field
    // reflects the news outlet's country, NOT the article's subject country.
    // Populating relatedCountries from it would cause the rssMarkerAdapter
    // fallback to place markers at the wrong location (e.g. US marker for a
    // Ukraine story covered by a US outlet).  Title-text matching is relied
    // on exclusively for GDELT item_location markers.
    const relatedCountries: string[] = [];

    items.push({
      id: `${source.id}::${article.url}`,
      sourceId: source.id,
      sourceName: `${source.name} — ${article.domain}`,
      title,
      summary: "",
      url: article.url,
      publishedAt,
      collectedAt,
      sourceType: "api",
      sourceStatus: source.sourceStatus,
      verificationStatus: "source_reported",
      sourceBasis: "single_public_source",
      extractionMethod: "api_result",
      sourceLanguage: normalizeSourceLanguage(article.language),
      relatedCountries,
      relatedRegions: [source.regionScope],
      category: article._category,
      isSample: false,
      sourceProfile: source.sourceProfile,
      markerLocationStrategy: source.markerLocationStrategy,
      sourceLocationForMarker:
        coords && countryName
          ? { lat: coords.lat, lng: coords.lng, locationName: countryName }
          : undefined,
    });
  }

  return items;
}
