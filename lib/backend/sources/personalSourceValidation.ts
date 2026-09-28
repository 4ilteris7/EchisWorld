import type { SourceLanguage, SourceRegionScope } from "@/data/sources/sourceTypes";
import { safeFetch } from "@/lib/backend/collector/safeFetch";
import {
  personalSourceToLegacyDefinition,
  type PersonalConnectorType,
  type PersonalSource,
  type PersonalSourceCategory,
} from "@/lib/backend/sources/personalSources";
import { parseRssPreviewItemsFromXml } from "@/lib/sources/rssPreviewAdapter";
import { parsePublicJsonFeedItems } from "@/lib/sources/publicJsonFeedAdapter";

const LANGUAGES = new Set(["tr", "en", "ar", "fr", "es", "ru", "de", "sr", "el", "az", "zh", "vi"]);
const REGIONS = new Set(["global", "north_america", "middle_east", "europe", "asia_pacific", "americas", "africa"]);
const CATEGORIES = new Set(["global", "cyber", "defense", "policy"]);
const CONNECTORS = new Set(["rss", "json"]);

export type PersonalSourceDraft = {
  name: string;
  connectorType: PersonalConnectorType;
  endpoint: string;
  category: PersonalSourceCategory;
  language: SourceLanguage;
  regionScope: SourceRegionScope;
};

export type PersonalSourceProbe = {
  itemCount: number;
  finalUrl: string;
  contentType?: string;
  samples: Array<{ title: string; url?: string; publishedAt?: string }>;
};

export function parsePersonalSourceDraft(value: unknown): PersonalSourceDraft {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const connectorType = input.connectorType;
  const category = input.category;
  const language = input.language;
  const regionScope = input.regionScope;
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  if (name.length < 2 || name.length > 120) throw new Error("invalid_name");
  if (!CONNECTORS.has(String(connectorType))) throw new Error("invalid_connector_type");
  if (!CATEGORIES.has(String(category))) throw new Error("invalid_category");
  if (!LANGUAGES.has(String(language))) throw new Error("invalid_language");
  if (!REGIONS.has(String(regionScope))) throw new Error("invalid_region");
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error("invalid_url"); }
  if (parsed.protocol !== "https:") throw new Error("https_required");
  if (parsed.username || parsed.password) throw new Error("credentials_in_url_not_allowed");
  return {
    name,
    connectorType: connectorType as PersonalConnectorType,
    endpoint: parsed.href,
    category: category as PersonalSourceCategory,
    language: language as SourceLanguage,
    regionScope: regionScope as SourceRegionScope,
  };
}

export async function probePersonalSource(
  draft: PersonalSourceDraft,
): Promise<PersonalSourceProbe> {
  const response = await safeFetch(draft.endpoint, {
    timeoutMs: 12_000,
    maxBodyBytes: 2 * 1024 * 1024,
    accept: draft.connectorType === "rss"
      ? "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8"
      : "application/feed+json, application/json;q=0.9",
  });
  if (response.status < 200 || response.status >= 300 || !response.body) {
    throw new Error(`upstream_${response.status}`);
  }
  const temp: PersonalSource = {
    sourceId: "personal-00000000-0000-0000-0000-000000000000",
    ...draft,
    enabled: true,
    lastValidatedAt: new Date().toISOString(),
    validationItemCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const definition = personalSourceToLegacyDefinition(temp);
  let items;
  try {
    items = draft.connectorType === "rss"
      ? parseRssPreviewItemsFromXml(definition, response.body, new Date().toISOString())
      : parsePublicJsonFeedItems(definition, response.body);
  } catch {
    throw new Error(draft.connectorType === "rss" ? "invalid_rss" : "invalid_json_feed");
  }
  if (items.length === 0) throw new Error("no_parseable_items");
  return {
    itemCount: items.length,
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    samples: items.slice(0, 3).map((item) => ({
      title: item.title,
      url: item.url || undefined,
      publishedAt: item.publishedAt || undefined,
    })),
  };
}

