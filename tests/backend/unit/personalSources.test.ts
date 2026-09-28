import { describe, expect, it } from "vitest";
import type { SourceDefinition } from "@/data/sources/sourceTypes";
import { parsePublicJsonFeedItems } from "@/lib/sources/publicJsonFeedAdapter";
import { parsePersonalSourceDraft } from "@/lib/backend/sources/personalSourceValidation";
import { sourceRegistry } from "@/data/source-intelligence/sourceRegistry";
import {
  personalSourceToManifestEntry,
  targetScreensForPersonalSource,
  type PersonalSource,
} from "@/lib/backend/sources/personalSources";

const definition: SourceDefinition = {
  id: "personal-00000000-0000-0000-0000-000000000000",
  name: "Local Feed",
  category: "Cyber",
  accessType: "api",
  candidateStatus: "candidate_test",
  sourceStatus: "public_news_source",
  verificationStatus: "source_reported",
  sourceBasis: "single_public_source",
  extractionMethod: "api_result",
  baseUrl: "https://example.com",
  language: "en",
  regionScope: "global",
  targetScreens: ["monitor", "cyber_news"],
};

const personal: PersonalSource = {
  sourceId: definition.id,
  name: definition.name,
  connectorType: "json",
  endpoint: "https://example.com/feed.json",
  category: "cyber",
  language: "en",
  regionScope: "global",
  enabled: true,
  lastValidatedAt: "2026-09-28T10:00:00.000Z",
  validationItemCount: 2,
  createdAt: "2026-09-28T10:00:00.000Z",
  updatedAt: "2026-09-28T10:00:00.000Z",
};

describe("personal source validation", () => {
  it("normalizes a valid HTTPS draft", () => {
    expect(parsePersonalSourceDraft({
      name: "  Local Feed  ",
      connectorType: "rss",
      endpoint: "https://example.com/feed.xml",
      category: "global",
      language: "en",
      regionScope: "global",
    })).toMatchObject({ name: "Local Feed", endpoint: "https://example.com/feed.xml" });
  });

  it("rejects insecure and credential-bearing endpoints", () => {
    const base = {
      name: "Local Feed", connectorType: "rss", category: "global",
      language: "en", regionScope: "global",
    };
    expect(() => parsePersonalSourceDraft({ ...base, endpoint: "http://example.com/feed" }))
      .toThrow("https_required");
    expect(() => parsePersonalSourceDraft({ ...base, endpoint: "https://user:pass@example.com/feed" }))
      .toThrow("credentials_in_url_not_allowed");
  });
});

describe("public JSON source adapter", () => {
  it("parses JSON Feed items", () => {
    const items = parsePublicJsonFeedItems(definition, JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      items: [{ id: "a-1", title: "Security bulletin", url: "https://example.com/a", date_published: "2026-09-28T09:00:00Z", summary: "Summary" }],
    }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Security bulletin", extractionMethod: "api_result" });
  });

  it("parses common article envelopes and drops rows without titles", () => {
    const items = parsePublicJsonFeedItems(definition, JSON.stringify({
      articles: [
        { headline: "Policy update", link: "https://example.com/policy", published_at: "2026-09-28T08:00:00Z" },
        { description: "No title" },
      ],
    }));
    expect(items.map((item) => item.title)).toEqual(["Policy update"]);
  });
});

describe("personal source catalog mapping", () => {
  it("keeps the source in Monitor and adds its selected specialist screen", () => {
    expect(targetScreensForPersonalSource("cyber")).toEqual(["monitor", "cyber_news"]);
    expect(targetScreensForPersonalSource("global")).toEqual(["monitor"]);
    expect(personalSourceToManifestEntry(personal)).toMatchObject({
      collectionMethod: "api",
      critical: false,
      targetScreens: ["monitor", "cyber_news"],
    });
  });

  it("presents the long-running built-in RSS fleet as active, not test", () => {
    const rssSources = sourceRegistry.filter((source) => source.collectionMethod === "rss");
    expect(rssSources.length).toBeGreaterThan(0);
    expect(rssSources.every((source) => source.sourceStatus === "active")).toBe(true);
  });
});
