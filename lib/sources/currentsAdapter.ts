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
const CURRENTS_SEARCH_URL = "https://api.currentsapi.services/v1/search";

const GEOPOLITICAL_KEYWORDS =
  "war OR conflict OR ceasefire OR airstrike OR invasion OR " +
  "diplomacy OR sanctions OR summit OR treaty OR negotiations OR " +
  "military OR troops OR NATO OR coup OR nuclear OR Ukraine OR Russia OR " +
  "Iran OR Israel OR Gaza OR Taiwan OR China";

interface CurrentsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  published: string;
  author?: string;
  category?: string[];
}

interface CurrentsApiResponse {
  news?: CurrentsArticle[];
  status?: string;
}

export async function fetchCurrentsArticles(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  const apiKey = process.env.CURRENTS_API_KEY;
  if (!apiKey) {
    throw new Error("currents_key_not_configured");
  }

  const params = new URLSearchParams({
    apiKey,
    language: "en",
    category: "politics",
    keywords: GEOPOLITICAL_KEYWORDS,
    page_size: "50",
  });

  const url = `${CURRENTS_SEARCH_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let data: CurrentsApiResponse;
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

  const articles = data.news;
  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  const collectedAt = new Date().toISOString();
  const items: NormalizedSourceItem[] = [];

  for (const article of articles) {
    if (!article.title || !article.url) continue;

    const rawSummary = article.description ?? "";
    const summary = stripHtml(rawSummary);

    const scanText = article.title + " " + summary;
    const relatedCountries = extractCountriesFromText(scanText);
    const firstCountry = relatedCountries[0];
    const coords = firstCountry ? COUNTRY_COORDS[firstCountry] : undefined;

    items.push({
      id: `${source.id}::${article.id}`,
      sourceId: source.id,
      sourceName: "Currents API",
      title: article.title,
      summary,
      url: article.url,
      publishedAt: article.published,
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
