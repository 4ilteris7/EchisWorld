import { describe, expect, it } from "vitest";
import {
  CANONICAL_SOURCE_MANIFEST,
  RSS_PREVIEW_ALLOWLIST_SOURCE_IDS,
  getManifestEntry,
  manifestSourceIdsForScreen,
  validateCanonicalSourceManifest,
  type CanonicalSourceManifestEntry,
} from "@/lib/backend/sources/manifest";
import { candidateSourceDefinitions } from "@/data/sources/sourceDefinitions";
import { SOURCE_INTELLIGENCE_DEFAULT_SOURCE_IDS } from "@/data/source-intelligence/sourceRegistry";
import { CYBER_NEWS_SOURCE_IDS } from "@/components/cyber/useCyberNewsFeed";
import { DEFENSE_SOURCE_IDS } from "@/components/defense-industry/useDefenseIndustryFeed";
import { POLICY_SOURCE_IDS } from "@/components/policy/usePolicyFeed";

function ids(entries: readonly CanonicalSourceManifestEntry[]): string[] {
  return entries.map((e) => e.sourceId);
}

describe("canonical source manifest — F0D exit criteria", () => {
  it("contains exactly the 296 unique registered sources", () => {
    expect(CANONICAL_SOURCE_MANIFEST).toHaveLength(296);
    expect(new Set(ids(CANONICAL_SOURCE_MANIFEST)).size).toBe(296);
    expect(new Set(ids(CANONICAL_SOURCE_MANIFEST))).toEqual(
      new Set(candidateSourceDefinitions.map((d) => d.id)),
    );
  });

  it("reproduces the global pipeline source set (256)", () => {
    const monitor = new Set(manifestSourceIdsForScreen("monitor"));
    expect(monitor.size).toBe(256);
    expect(monitor).toEqual(new Set(SOURCE_INTELLIGENCE_DEFAULT_SOURCE_IDS));
  });

  it("reproduces the Cyber News source set (35)", () => {
    const cyber = new Set(manifestSourceIdsForScreen("cyber_news"));
    expect(cyber.size).toBe(35);
    expect(cyber).toEqual(new Set(CYBER_NEWS_SOURCE_IDS));
  });

  it("reproduces the Defense Industry source set (32)", () => {
    const defense = new Set(manifestSourceIdsForScreen("defense_industry"));
    expect(defense.size).toBe(32);
    expect(defense).toEqual(new Set(DEFENSE_SOURCE_IDS));
  });

  it("reproduces the Policy source set (65)", () => {
    const policy = new Set(manifestSourceIdsForScreen("policy"));
    expect(policy.size).toBe(65);
    expect(policy).toEqual(new Set(POLICY_SOURCE_IDS));
  });

  it("derives the RSS route allowlist: all RSS sources, no API sources", () => {
    expect(RSS_PREVIEW_ALLOWLIST_SOURCE_IDS.size).toBe(290);
    const rssDefs = candidateSourceDefinitions.filter(
      (d) => d.accessType === "rss",
    );
    expect(RSS_PREVIEW_ALLOWLIST_SOURCE_IDS).toEqual(
      new Set(rssDefs.map((d) => d.id)),
    );
    for (const entry of CANONICAL_SOURCE_MANIFEST) {
      if (entry.collectionMethod !== "rss") {
        expect(RSS_PREVIEW_ALLOWLIST_SOURCE_IDS.has(entry.sourceId)).toBe(false);
      }
    }
  });

  it("every screen RSS source is allowlisted for the preview route", () => {
    const screenIds = [
      ...CYBER_NEWS_SOURCE_IDS,
      ...DEFENSE_SOURCE_IDS,
      ...POLICY_SOURCE_IDS,
    ];
    for (const id of screenIds) {
      expect(RSS_PREVIEW_ALLOWLIST_SOURCE_IDS.has(id)).toBe(true);
    }
  });
});

describe("canonical source manifest — operational profiles", () => {
  it("passes its own validation", () => {
    expect(validateCanonicalSourceManifest(CANONICAL_SOURCE_MANIFEST)).toEqual([]);
  });

  it("gives every source a positive min ≤ base ≤ max window", () => {
    for (const entry of CANONICAL_SOURCE_MANIFEST) {
      const s = entry.schedule;
      expect(s.minPollIntervalSeconds).toBeGreaterThan(0);
      expect(s.minPollIntervalSeconds).toBeLessThanOrEqual(
        s.basePollIntervalSeconds,
      );
      expect(s.basePollIntervalSeconds).toBeLessThanOrEqual(
        s.maxPollIntervalSeconds,
      );
    }
  });

  it("never allows any source to poll faster than 5 minutes", () => {
    for (const entry of CANONICAL_SOURCE_MANIFEST) {
      expect(entry.schedule.minPollIntervalSeconds).toBeGreaterThanOrEqual(300);
    }
  });

  it("uses https endpoints everywhere", () => {
    for (const entry of CANONICAL_SOURCE_MANIFEST) {
      expect(entry.endpoint).toMatch(/^https:\/\//);
    }
  });

  it("RSS endpoints equal the verified candidateFeedUrl", () => {
    for (const def of candidateSourceDefinitions) {
      if (def.accessType !== "rss") continue;
      expect(getManifestEntry(def.id)?.endpoint).toBe(def.candidateFeedUrl);
    }
  });

  it("quota-limited sources always carry a machine-readable budget", () => {
    for (const entry of CANONICAL_SOURCE_MANIFEST) {
      if (entry.schedule.scheduleMode === "quota_limited") {
        expect(
          entry.schedule.dailyRequestBudget?.requestsPerDay,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("marks a small explicit critical set, present on every screen", () => {
    const critical = CANONICAL_SOURCE_MANIFEST.filter((e) => e.critical);
    expect(critical.length).toBeGreaterThanOrEqual(5);
    expect(critical.length).toBeLessThanOrEqual(15);
    for (const screen of [
      "monitor",
      "cyber_news",
      "defense_industry",
      "policy",
    ] as const) {
      expect(
        critical.some((e) => e.targetScreens.includes(screen)),
      ).toBe(true);
    }
  });
});

describe("validateCanonicalSourceManifest — rejects broken definitions", () => {
  const valid = CANONICAL_SOURCE_MANIFEST[0];

  function withSchedule(
    patch: Partial<CanonicalSourceManifestEntry["schedule"]>,
  ): CanonicalSourceManifestEntry {
    return { ...valid, schedule: { ...valid.schedule, ...patch } };
  }

  it("rejects min > base and base > max", () => {
    expect(
      validateCanonicalSourceManifest([
        withSchedule({ minPollIntervalSeconds: 10_000 }),
      ]),
    ).not.toEqual([]);
    expect(
      validateCanonicalSourceManifest([
        withSchedule({ maxPollIntervalSeconds: 1 }),
      ]),
    ).not.toEqual([]);
  });

  it("rejects non-https endpoints", () => {
    expect(
      validateCanonicalSourceManifest([
        { ...valid, endpoint: "http://insecure.example/rss" },
      ]),
    ).not.toEqual([]);
  });

  it("rejects sources without a target screen", () => {
    expect(
      validateCanonicalSourceManifest([{ ...valid, targetScreens: [] }]),
    ).not.toEqual([]);
  });

  it("rejects duplicate ids", () => {
    expect(validateCanonicalSourceManifest([valid, valid])).not.toEqual([]);
  });

  it("rejects quota_limited sources without a budget", () => {
    expect(
      validateCanonicalSourceManifest([
        withSchedule({
          scheduleMode: "quota_limited",
          dailyRequestBudget: undefined,
        }),
      ]),
    ).not.toEqual([]);
  });
});
