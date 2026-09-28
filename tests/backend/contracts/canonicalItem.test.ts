import { describe, expect, it } from "vitest";
import {
  canonicalItemFromIntelligenceItem,
  canonicalItemFromScreenItem,
  canonicalizeUrl,
  computeItemFingerprint,
  extractUpstreamItemId,
} from "@/lib/backend/contracts/canonicalItem";
import type { NormalizedSourceItem as LegacyScreenItem } from "@/data/sources/sourceTypes";
import type { NormalizedSourceItem as LegacyIntelItem } from "@/data/source-intelligence/sourceIntelligenceTypes";

describe("canonicalizeUrl", () => {
  it("strips tracking params and fragments, keeps meaningful params", () => {
    expect(
      canonicalizeUrl(
        "https://News.Example/Path/article?utm_source=rss&id=42&fbclid=xyz#section",
      ),
    ).toBe("https://news.example/Path/article?id=42");
  });

  it("trims trailing slashes except on the root path", () => {
    expect(canonicalizeUrl("https://a.example/story/")).toBe(
      "https://a.example/story",
    );
    expect(canonicalizeUrl("https://a.example/")).toBe("https://a.example/");
  });

  it("rejects non-http(s) and malformed input", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(canonicalizeUrl("ftp://a.example/x")).toBeUndefined();
    expect(canonicalizeUrl("")).toBeUndefined();
    expect(canonicalizeUrl(undefined)).toBeUndefined();
  });
});

describe("computeItemFingerprint", () => {
  it("is stable and insensitive to case, punctuation and extra whitespace", () => {
    const a = computeItemFingerprint(
      "src-a",
      "Summit concludes: joint statement!",
      "2026-07-22T09:30:00.000Z",
    );
    const b = computeItemFingerprint(
      "src-a",
      "  summit   concludes — joint statement ",
      "2026-07-22T09:30:00.000Z",
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across sources and publish times", () => {
    const base = computeItemFingerprint("src-a", "Same title", "2026-07-22T09:30:00.000Z");
    expect(computeItemFingerprint("src-b", "Same title", "2026-07-22T09:30:00.000Z")).not.toBe(base);
    expect(computeItemFingerprint("src-a", "Same title", "2026-07-23T09:30:00.000Z")).not.toBe(base);
    expect(computeItemFingerprint("src-a", "Same title")).not.toBe(base);
  });
});

describe("extractUpstreamItemId", () => {
  it("returns the upstream guid from composite ids", () => {
    expect(extractUpstreamItemId("src-a::guid-123", "src-a")).toBe("guid-123");
  });

  it("returns undefined for index-based fallback ids and foreign prefixes", () => {
    expect(
      extractUpstreamItemId("src-a::3::2026-07-22T09:30:00.000Z", "src-a"),
    ).toBeUndefined();
    expect(extractUpstreamItemId("other::guid-123", "src-a")).toBeUndefined();
    expect(extractUpstreamItemId("src-a::", "src-a")).toBeUndefined();
  });
});

describe("canonicalItemFromScreenItem (data/sources shape)", () => {
  const legacy: LegacyScreenItem = {
    id: "fixture-wire::fixture-guid-001",
    sourceId: "fixture-wire",
    sourceName: "Fixture Wire Service",
    title: "Fixture summit concludes with joint statement",
    summary: "Delegations issued a joint statement.",
    url: "https://fixture-wire.example/articles/summit?utm_source=rss",
    publishedAt: "2026-07-22T09:30:00.000Z",
    collectedAt: "2026-07-24T12:00:00.000Z",
    sourceType: "rss",
    sourceStatus: "official_feed",
    verificationStatus: "official_entry",
    sourceBasis: "single_official_source",
    extractionMethod: "rss_summary",
    sourceLanguage: "en",
    relatedCountries: [],
    relatedRegions: ["global"],
    category: "Global Events",
    isSample: false,
  };

  const canonical = canonicalItemFromScreenItem(legacy);

  it("maps identity, url and time fields", () => {
    expect(canonical.sourceId).toBe("fixture-wire");
    expect(canonical.upstreamItemId).toBe("fixture-guid-001");
    expect(canonical.canonicalUrl).toBe(
      "https://fixture-wire.example/articles/summit",
    );
    expect(canonical.publishedAt).toBe("2026-07-22T09:30:00.000Z");
    expect(canonical.collectedAt).toBe("2026-07-24T12:00:00.000Z");
  });

  it("maps the legacy trust vocabulary onto the canonical one", () => {
    expect(canonical.verification).toBe("official");
    expect(canonical.basis).toBe("official_source");
    expect(canonical.extraction).toBe("rss_summary");
  });

  it("computes a fingerprint identical to the direct computation", () => {
    expect(canonical.fingerprint).toBe(
      computeItemFingerprint(
        legacy.sourceId,
        legacy.title,
        legacy.publishedAt,
      ),
    );
  });
});

describe("canonicalItemFromIntelligenceItem (source-intelligence shape)", () => {
  const legacy: LegacyIntelItem = {
    id: "tass-world::guid-9",
    sourceId: "tass-world",
    sourceName: "TASS World",
    sourceType: "wire_agency",
    collectionMethod: "rss",
    title: "Fixture diplomatic meeting announced",
    url: "https://fixture.example/a?gclid=1",
    publishedAt: "2026-07-22T10:00:00.000Z",
    sourceBasis: "multi_source",
    verificationStatus: "cross_source_matched",
    extractionMethod: "rss_summary",
  };

  it("maps fields and applies the collectedAt fallback deterministically", () => {
    const canonical = canonicalItemFromIntelligenceItem(
      legacy,
      "2026-07-24T13:00:00.000Z",
    );
    expect(canonical.collectedAt).toBe("2026-07-24T13:00:00.000Z");
    expect(canonical.verification).toBe("multi_source");
    expect(canonical.basis).toBe("multiple_public_sources");
    expect(canonical.canonicalUrl).toBe("https://fixture.example/a");
    expect(canonical.upstreamItemId).toBe("guid-9");
  });

  it("defaults trust fields conservatively when the legacy item omits them", () => {
    const canonical = canonicalItemFromIntelligenceItem(
      {
        id: "x::1",
        sourceId: "x",
        sourceName: "X",
        sourceType: "global_news",
        collectionMethod: "rss",
        title: "Untrusted minimal item",
      },
      "2026-07-24T13:00:00.000Z",
    );
    expect(canonical.verification).toBe("reported");
    expect(canonical.basis).toBe("single_public_source");
    expect(canonical.extraction).toBe("rss_summary");
  });

  it("produces the same fingerprint as the screen mapping for the same story", () => {
    const fromIntel = canonicalItemFromIntelligenceItem(legacy, "2026-07-24T13:00:00.000Z");
    expect(fromIntel.fingerprint).toBe(
      computeItemFingerprint("tass-world", legacy.title, legacy.publishedAt),
    );
  });
});
