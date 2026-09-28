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
const FINLIGHT_BASE_URL = "https://api.finlight.me/v2/articles";

const GEOPOLITICAL_QUERY =
  "war OR conflict OR military OR diplomacy OR sanctions OR defense OR " +
  "NATO OR ceasefire OR foreign minister OR intelligence";

interface FinlightArticle {
  link: string;
  source: string;
  title: string;
  summary?: string;
  publishDate: string;
  language?: string;
  sentiment?: "positive" | "negative" | "neutral";
  confidence?: number;
  countries?: string[];
  categories?: string[];
}

interface FinlightApiResponse {
  articles?: FinlightArticle[];
  totalResults?: number;
}

export async function fetchFinlightArticles(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  const apiKey = process.env.FINLIGHT_API_KEY;
  if (!apiKey) {
    throw new Error("finlight_key_not_configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let data: FinlightApiResponse;
  try {
    const response = await fetch(FINLIGHT_BASE_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "EchisWorld/1.0",
      },
      body: JSON.stringify({
        query: GEOPOLITICAL_QUERY,
        language: "en",
        orderBy: "publishDate",
        order: "DESC",
        pageSize: 50,
        page: 1,
      }),
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

  const articles = data.articles;
  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  const collectedAt = new Date().toISOString();
  const items: NormalizedSourceItem[] = [];

  for (const article of articles) {
    if (!article.title || !article.link) continue;

    const rawSummary = article.summary ?? "";
    const cleanSummary = stripHtml(rawSummary);

    // Prepend sentiment tag when available
    const sentimentPrefix =
      article.sentiment && article.sentiment !== "neutral"
        ? `[Sentiment: ${article.sentiment}] `
        : "";
    const summary = sentimentPrefix + cleanSummary;

    // Prefer API-provided countries list; supplement with text extraction
    const apiCountries: string[] = (article.countries ?? [])
      .map((c) => {
        // API returns ISO alpha-2 codes or country names — normalise by
        // checking against known COUNTRY_COORDS keys (country names)
        const match = Object.keys(COUNTRY_COORDS).find(
          (name) => name.toLowerCase() === c.toLowerCase(),
        );
        return match ?? null;
      })
      .filter((c): c is string => c !== null);

    const scanText = article.title + " " + cleanSummary;
    const textCountries = extractCountriesFromText(scanText);
    const relatedCountries = [
      ...new Set([...apiCountries, ...textCountries]),
    ];

    const firstCountry = relatedCountries[0];
    const coords = firstCountry ? COUNTRY_COORDS[firstCountry] : undefined;

    items.push({
      id: `${source.id}::${article.link}`,
      sourceId: source.id,
      sourceName: `finlight — ${article.source}`,
      title: article.title,
      summary,
      url: article.link,
      publishedAt: article.publishDate,
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
