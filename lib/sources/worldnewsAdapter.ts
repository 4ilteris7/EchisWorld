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
const WORLDNEWS_URL = "https://api.worldnewsapi.com/search-news";
const WORLDNEWS_QUERY = "war conflict diplomacy sanctions NATO ceasefire";

interface WorldNewsArticle {
  id: number;
  title: string;
  text?: string;
  summary?: string;
  url: string;
  publish_date: string;
  source_country?: string;
  authors?: string[];
}

interface WorldNewsApiResponse {
  news?: WorldNewsArticle[];
  available?: number;
}

export async function fetchWorldNewsArticles(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  const apiKey = process.env.WORLDNEWS_API_KEY;
  if (!apiKey) {
    throw new Error("worldnews_key_not_configured");
  }

  const params = new URLSearchParams({
    "api-key": apiKey,
    text: WORLDNEWS_QUERY,
    language: "en",
    number: "50",
    sort: "publish-time",
    "sort-direction": "DESC",
  });

  const url = `${WORLDNEWS_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let data: WorldNewsApiResponse;
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
      const text = await response.text();
      const detail = text.trim().replace(/\s+/g, " ").slice(0, 180);
      throw new Error(
        `upstream_${response.status}${detail ? `: ${detail}` : ""}`,
      );
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

    const rawSummary = article.text ?? article.summary ?? "";
    const summary = stripHtml(rawSummary);

    const scanText = article.title + " " + summary;
    const relatedCountries = extractCountriesFromText(scanText);
    const firstCountry = relatedCountries[0];
    const coords = firstCountry ? COUNTRY_COORDS[firstCountry] : undefined;

    items.push({
      id: `${source.id}::${article.id}`,
      sourceId: source.id,
      sourceName: "World News API",
      title: article.title,
      summary,
      url: article.url,
      publishedAt: article.publish_date,
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
