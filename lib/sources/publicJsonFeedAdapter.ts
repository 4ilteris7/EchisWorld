import type {
  NormalizedSourceItem,
  SourceDefinition,
} from "@/data/sources/sourceTypes";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(row: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function itemArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  if (!root) return [];
  for (const key of ["items", "articles", "results", "data", "entries"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = record(root.data);
  if (data) {
    for (const key of ["items", "articles", "results", "entries"]) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
  }
  return [];
}

function validUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function validDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Parse JSON Feed plus common keyless news-API envelopes conservatively. */
export function parsePublicJsonFeedItems(
  source: SourceDefinition,
  body: string,
  collectedAt = new Date().toISOString(),
): NormalizedSourceItem[] {
  const payload = JSON.parse(body) as unknown;
  return itemArray(payload).slice(0, 100).flatMap((value, index) => {
    const row = record(value);
    if (!row) return [];
    const title = text(row, ["title", "headline", "name"]);
    if (!title) return [];
    const url = validUrl(text(row, ["url", "link", "web_url", "external_url"]));
    const publishedAt = validDate(text(row, [
      "date_published", "publishedAt", "published_at", "pubDate", "date", "created_at",
    ]));
    const identifier = text(row, ["id", "guid", "uuid"]) || url || `${index}::${publishedAt || collectedAt}`;
    return [{
      id: `${source.id}::${identifier}`,
      sourceId: source.id,
      sourceName: source.name,
      title: title.slice(0, 500),
      summary: text(row, ["summary", "description", "content_text", "excerpt"]).slice(0, 4_000),
      url,
      publishedAt,
      collectedAt,
      sourceType: "api" as const,
      sourceStatus: source.sourceStatus,
      verificationStatus: source.verificationStatus,
      sourceBasis: source.sourceBasis,
      extractionMethod: "api_result" as const,
      sourceLanguage: source.language,
      relatedCountries: [],
      relatedRegions: [source.regionScope],
      category: source.category,
      isSample: false,
      sourceProfile: source.sourceProfile,
      markerLocationStrategy: source.markerLocationStrategy,
    }];
  });
}

