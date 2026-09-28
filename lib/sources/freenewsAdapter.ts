import type {
  NormalizedSourceItem,
  SourceDefinition,
} from "@/data/sources/sourceTypes";
import {
  COUNTRY_COORDS,
  extractCountriesFromText,
  stripHtml,
} from "./countryCoords";

const FETCH_TIMEOUT_MS = 12_000;
const FREENEWS_BASE_URL = "https://api.freenewsapi.io/v1/news";

interface FreeNewsArticle {
  uuid: string;
  title: string;
  subtitle?: string;
  body?: string;
  original_url?: string;
  published_at: string;
  publisher: string;
  countries?: string[];
  languages?: string[];
  topics?: string[];
}

interface FreeNewsApiResponse {
  data?: FreeNewsArticle[];
  meta?: unknown;
}

export async function fetchFreeNewsArticles(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  const apiKey = process.env.FREENEWSAPI_KEY;
  if (!apiKey) {
    throw new Error("freenews_key_not_configured");
  }

  const params = new URLSearchParams({
    topic: "politics",
    language: "en",
    page_size: "50",
  });

  const url = `${FREENEWS_BASE_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let data: FreeNewsApiResponse;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        "User-Agent": "EchisWorld/1.0",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`upstream_${response.status}`);
    }
    data = await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const articles = data.data;
  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  const collectedAt = new Date().toISOString();
  const items: NormalizedSourceItem[] = [];

  for (const article of articles) {
    if (!article.title) continue;
    // original_url is present in detail responses; fall back to a uuid-based
    // placeholder if the listing endpoint omits it.
    const articleUrl = article.original_url ?? `https://www.freenewsapi.io/article/${article.uuid}`;

    const rawSummary = article.body ?? article.subtitle ?? "";
    const summary = stripHtml(rawSummary);

    const scanText = article.title + " " + summary;
    const relatedCountries = extractCountriesFromText(scanText);
    const firstCountry = relatedCountries[0];
    const coords = firstCountry ? COUNTRY_COORDS[firstCountry] : undefined;

    items.push({
      id: `${source.id}::${article.uuid}`,
      sourceId: source.id,
      sourceName: `FreeNewsAPI — ${article.publisher}`,
      title: article.title,
      summary,
      url: articleUrl,
      publishedAt: article.published_at,
      collectedAt,
      sourceType: "api",
      sourceStatus: source.sourceStatus,
      verificationStatus: "source_reported",
      sourceBasis: "single_public_source",
      extractionMethod: "api_result",
      sourceLanguage: "en",
      relatedCountries,
      relatedRegions: [source.regionScope],
      category: source.category,
      isSample: false,
      sourceProfile: "general_news",
      markerLocationStrategy: "item_location",
      ...(firstCountry && coords
        ? {
            sourceLocationForMarker: {
              lat: coords.lat,
              lng: coords.lng,
              locationName: firstCountry,
            },
          }
        : {}),
    });
  }

  return items;
}
