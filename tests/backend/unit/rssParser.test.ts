import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRssPreviewItemsFromXml } from "@/lib/sources/rssPreviewAdapter";
import type { SourceDefinition } from "@/data/sources/sourceTypes";

const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const COLLECTED_AT = "2026-07-24T12:00:00.000Z";

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

function makeSource(overrides: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    id: "fixture-wire",
    name: "Fixture Wire Service",
    category: "Global Events",
    accessType: "rss",
    candidateStatus: "candidate_test",
    sourceStatus: "established_media",
    verificationStatus: "source_reported",
    sourceBasis: "single_public_source",
    extractionMethod: "rss_summary",
    baseUrl: "https://fixture-wire.example",
    candidateFeedUrl: "https://fixture-wire.example/rss.xml",
    language: "en",
    regionScope: "global",
    targetScreens: ["monitor"],
    sourceProfile: "general_news",
    markerLocationStrategy: "item_location",
    ...overrides,
  };
}

describe("parseRssPreviewItemsFromXml — RSS 2.0 fixture", () => {
  const items = parseRssPreviewItemsFromXml(
    makeSource(),
    fixture("rss2-sample.xml"),
    COLLECTED_AT,
  );

  it("parses valid items and drops malformed + editorial ones", () => {
    // 4 <item> blocks: 1 empty title (skipped), 1 newsletter plug (dropped).
    expect(items.map((i) => i.title)).toEqual([
      "Fixture summit concludes with joint statement",
      "Ministry publishes annual fixture report",
    ]);
  });

  it("builds composite ids from the upstream guid", () => {
    expect(items[0].id).toBe("fixture-wire::fixture-guid-001");
    expect(items[1].id).toBe("fixture-wire::fixture-guid-002");
  });

  it("normalizes dates to ISO and keeps the collectedAt stamp", () => {
    expect(items[0].publishedAt).toBe("2026-07-22T09:30:00.000Z");
    expect(items[0].collectedAt).toBe(COLLECTED_AT);
  });

  it("strips CDATA and inline HTML from summaries", () => {
    expect(items[0].summary).toBe(
      "Delegations from two fixture states issued a joint statement after talks.",
    );
  });

  it("keeps item URLs as-is (canonicalization is the contract layer's job)", () => {
    expect(items[0].url).toBe(
      "https://fixture-wire.example/articles/summit-statement?utm_source=rss&utm_medium=feed",
    );
  });
});

describe("parseRssPreviewItemsFromXml — Atom fixture", () => {
  const source = makeSource({
    id: "fixture-security",
    name: "Fixture Security Blog",
    baseUrl: "https://fixture-security.example",
    candidateFeedUrl: "https://fixture-security.example/atom.xml",
    targetScreens: ["cyber_news"],
  });
  const items = parseRssPreviewItemsFromXml(
    source,
    fixture("atom-sample.xml"),
    COLLECTED_AT,
  );

  it("parses atom entries with rel=alternate links", () => {
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe(
      "https://fixture-security.example/advisories/sample-flaw",
    );
  });

  it("prefers <published> over <updated> for the publish time", () => {
    expect(items[0].publishedAt).toBe("2026-07-22T09:45:00.000Z");
  });
});

describe("parseRssPreviewItemsFromXml — failure classification", () => {
  it("rejects HTML bodies instead of inventing items", () => {
    expect(() =>
      parseRssPreviewItemsFromXml(
        makeSource(),
        "<!doctype html><html><body>error page</body></html>",
        COLLECTED_AT,
      ),
    ).toThrowError();
  });

  it("rejects feeds without any item block", () => {
    expect(() =>
      parseRssPreviewItemsFromXml(
        makeSource(),
        '<?xml version="1.0"?><rss version="2.0"><channel><title>empty</title></channel></rss>',
        COLLECTED_AT,
      ),
    ).toThrowError(/rss_no_items_found/);
  });
});
