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
const NEWSDATA_URL = "https://newsdata.io/api/1/latest";
const NEWSDATA_QUERY = "war conflict diplomacy sanctions NATO ceasefire";

interface NewsdataArticle {
  article_id: string;
  title: string;
  description?: string | null;
  link: string;
  pubDate: string;
  source_name?: string;
  country?: string[];
}

interface NewsdataApiResponse {
  results?: NewsdataArticle[];
  status?: string;
}

export async function fetchNewsdataArticles(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    throw new Error("newsdata_key_not_configured");
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    q: NEWSDATA_QUERY,
    category: "politics,world",
    language: "en,tr",
    size: "10",
  });

  const url = `${NEWSDATA_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let data: NewsdataApiResponse;
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

  const results = data.results;
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  const collectedAt = new Date().toISOString();
  const items: NormalizedSourceItem[] = [];

  for (const article of results) {
    if (!article.title || !article.link) continue;

    const rawSummary = article.description ?? "";
    const summary = stripHtml(rawSummary);

    const scanText = article.title + " " + summary;
    const relatedCountries = extractCountriesFromText(scanText);
    const firstCountry = relatedCountries[0];
    const coords = firstCountry ? COUNTRY_COORDS[firstCountry] : undefined;

    items.push({
      id: `${source.id}::${article.article_id}`,
      sourceId: source.id,
      sourceName: article.source_name ?? "NewsData.io",
      title: article.title,
      summary,
      url: article.link,
      publishedAt: article.pubDate,
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
