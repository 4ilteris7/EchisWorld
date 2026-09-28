// F2D/F5 exit evidence: full collector cycle against the real test database
// with injected fetchers (no network). Covers: bootstrap, RSS + API branches,
// insert+dedupe tiers, 304 flow, failure backoff, run bookkeeping,
// retention/tombstones.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  runCollectorCycle,
  rssTtlSeconds,
  groupByHost,
} from "@/lib/backend/collector/collector";
import type { Fetcher } from "@/lib/backend/collector/collector";
import type { ApiSourceFetcher } from "@/lib/backend/collector/apiAdapters";
import {
  pilotManifestEntries,
  PILOT_SOURCE_IDS,
} from "@/lib/backend/collector/pilot";
import { CANONICAL_SOURCE_MANIFEST } from "@/lib/backend/sources/manifest";
import { ensureSourceStateRows } from "@/lib/backend/repositories/sourceStateRepo";
import { purgeExpired } from "@/lib/backend/repositories/itemsRepo";
import type { SafeFetchResult } from "@/lib/backend/collector/safeFetch";
import type { NormalizedSourceItem as LegacyScreenItem } from "@/data/sources/sourceTypes";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;

const API_IDS = CANONICAL_SOURCE_MANIFEST.filter(
  (e) => e.collectionMethod !== "rss",
).map((e) => e.sourceId);
const ALL_COUNT = PILOT_SOURCE_IDS.length;
const RSS_COUNT = ALL_COUNT - API_IDS.length;

type ItemSpec = { guid: string; title: string; link: string };

function feedXml(items: ItemSpec[]): string {
  const blocks = items
    .map(
      (i) => `<item><title>${i.title}</title><link>${i.link}</link>
<guid isPermaLink="false">${i.guid}</guid>
<pubDate>Wed, 22 Jul 2026 09:30:00 GMT</pubDate>
<description>synthetic</description></item>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><ttl>30</ttl>${blocks}</channel></rss>`;
}

function legacyApiItems(sourceId: string, items: ItemSpec[]): LegacyScreenItem[] {
  return items.map((i) => ({
    id: `${sourceId}::${i.guid}`,
    sourceId,
    sourceName: sourceId,
    title: i.title,
    summary: "synthetic",
    url: i.link,
    publishedAt: "2026-07-22T09:30:00.000Z",
    collectedAt: new Date().toISOString(),
    sourceType: "api",
    sourceStatus: "established_media",
    verificationStatus: "source_reported",
    sourceBasis: "multiple_public_sources",
    extractionMethod: "api_result",
    relatedCountries: [],
    relatedRegions: ["global"],
    category: "Global Events",
    isSample: false,
  }));
}

/** Stub every API source with the same item specs the RSS fetcher serves. */
function apiStub(items: ItemSpec[]): Record<string, ApiSourceFetcher> {
  const stub: Record<string, ApiSourceFetcher> = {};
  for (const id of API_IDS) {
    stub[id] = async (def) => legacyApiItems(def.id, items);
  }
  return stub;
}

function failingApiStub(): Record<string, ApiSourceFetcher> {
  const stub: Record<string, ApiSourceFetcher> = {};
  for (const id of API_IDS) {
    stub[id] = async () => {
      throw new Error("api_down");
    };
  }
  return stub;
}

function ok(body: string, etag: string): SafeFetchResult {
  return {
    status: 200,
    notModified: false,
    body,
    etag,
    contentType: "application/rss+xml",
    finalUrl: "https://x.example/feed",
    redirects: 0,
    durationMs: 5,
    bytes: body.length,
  };
}

const NOT_MODIFIED: SafeFetchResult = {
  status: 304,
  notModified: true,
  etag: '"v1"',
  finalUrl: "https://x.example/feed",
  redirects: 0,
  durationMs: 3,
  bytes: 0,
};

const TWO_ITEMS: ItemSpec[] = [
  { guid: "g1", title: "Story one about a fixture flaw", link: "https://x.example/1" },
  { guid: "g2", title: "Story two about another fixture", link: "https://x.example/2" },
];

// A stable RSS source id for per-source state assertions.
const RSS_PROBE_ID = "the-hacker-news";

describe.skipIf(!hasDb)("collector cycle (F2D/F5)", () => {
  let pg: typeof import("pg");
  let pool: Pool;

  beforeAll(async () => {
    pg = await import("pg");
    pool = new pg.Pool({ connectionString: TEST_URL, max: 3 });
    const { migrate } = await import("../../../scripts/db-migrate.mjs");
    await migrate({ log: () => {} });
    await pool.query(
      "TRUNCATE collected_items, dedupe_tombstones, collector_source_results, collector_runs RESTART IDENTITY CASCADE",
    );
    await pool.query("DELETE FROM source_runtime_state");
    process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
  });

  afterAll(async () => {
    await pool?.end();
    const { closePools } = await import("@/lib/backend/db/pool");
    await closePools();
  });

  it("bootstraps the full rollout scope idempotently", async () => {
    const first = await ensureSourceStateRows(pool, pilotManifestEntries());
    expect(first).toBe(ALL_COUNT);
    const second = await ensureSourceStateRows(pool, pilotManifestEntries());
    expect(second).toBe(0);
  });

  it("collects RSS + API sources, inserts items, records run + state", async () => {
    const rssCalls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      rssCalls.push(url);
      return ok(feedXml(TWO_ITEMS), '"v1"');
    };

    const summary = await runCollectorCycle(pool, {
      batchLimit: ALL_COUNT,
      fetcher,
      apiFetchers: apiStub(TWO_ITEMS),
      buildId: "test",
    });
    expect(summary.attempted).toBe(ALL_COUNT);
    expect(summary.succeeded).toBe(ALL_COUNT);
    expect(summary.errors).toBe(0);
    expect(summary.newItems).toBe(2 * ALL_COUNT);
    expect(rssCalls.length).toBe(RSS_COUNT);

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM collected_items",
    );
    expect(rows[0].n).toBe(2 * ALL_COUNT);

    const state = await pool.query(
      `SELECT etag, rss_ttl_hint_seconds, last_new_item_count, next_poll_at > now() AS scheduled
         FROM source_runtime_state WHERE source_id = $1`,
      [RSS_PROBE_ID],
    );
    expect(state.rows[0].etag).toBe('"v1"');
    expect(state.rows[0].rss_ttl_hint_seconds).toBe(1800); // <ttl>30</ttl>
    expect(state.rows[0].last_new_item_count).toBe(2);
    expect(state.rows[0].scheduled).toBe(true);

    const run = await pool.query(
      "SELECT status, attempted_sources, new_items FROM collector_runs ORDER BY id DESC LIMIT 1",
    );
    expect(run.rows[0].status).toBe("success");
    expect(run.rows[0].new_items).toBe(2 * ALL_COUNT);
  });

  it("does nothing when no source is due", async () => {
    const fetcher: Fetcher = async () => {
      throw new Error("must not fetch");
    };
    const summary = await runCollectorCycle(pool, {
      batchLimit: ALL_COUNT,
      fetcher,
      apiFetchers: failingApiStub(),
    });
    expect(summary.attempted).toBe(0);
    expect(summary.runId).toBeNull();
  });

  it("sends conditional headers on RSS; 304 counts as success without inserts", async () => {
    await pool.query("UPDATE source_runtime_state SET next_poll_at = now()");
    const seenEtags: Array<string | undefined> = [];
    const fetcher: Fetcher = async (_url, options) => {
      seenEtags.push(options.etag);
      return NOT_MODIFIED;
    };
    const summary = await runCollectorCycle(pool, {
      batchLimit: ALL_COUNT,
      fetcher,
      apiFetchers: apiStub(TWO_ITEMS), // API re-serves same items → duplicates
    });
    expect(summary.notModified).toBe(RSS_COUNT);
    expect(summary.errors).toBe(0);
    expect(summary.newItems).toBe(0);
    expect(summary.duplicates).toBe(2 * API_IDS.length);
    expect(seenEtags.length).toBe(RSS_COUNT);
    expect(seenEtags.every((e) => e === '"v1"')).toBe(true);

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM collected_items",
    );
    expect(rows[0].n).toBe(2 * ALL_COUNT); // unchanged
  });

  it("re-sent items dedupe on guid, url and fingerprint tiers", async () => {
    await pool.query("UPDATE source_runtime_state SET next_poll_at = now()");
    const resent: ItemSpec[] = [
      // same guid as before → tier-1 dupe
      { guid: "g1", title: "Story one about a fixture flaw", link: "https://x.example/1" },
      // new guid, same link (tracking param) → tier-2 dupe (canonical url)
      { guid: "g9", title: "Retitled second story", link: "https://x.example/2?utm_source=feed" },
    ];
    const fetcher: Fetcher = async () => ok(feedXml(resent), '"v2"');
    const summary = await runCollectorCycle(pool, {
      batchLimit: ALL_COUNT,
      fetcher,
      apiFetchers: apiStub(resent),
    });
    expect(summary.newItems).toBe(0);
    expect(summary.duplicates).toBe(2 * ALL_COUNT);
  });

  it("failure path backs off without erasing learned state", async () => {
    await pool.query("UPDATE source_runtime_state SET next_poll_at = now()");
    const fetcher: Fetcher = async () => {
      const { SafeFetchError } = await import(
        "@/lib/backend/collector/safeFetch"
      );
      throw new SafeFetchError("timeout");
    };
    const summary = await runCollectorCycle(pool, {
      batchLimit: ALL_COUNT,
      fetcher,
      apiFetchers: failingApiStub(),
    });
    expect(summary.errors).toBe(ALL_COUNT);

    const state = await pool.query(
      `SELECT consecutive_failures, schedule_reason, last_error_code, etag,
              backoff_until > now() AS backing_off
         FROM source_runtime_state WHERE source_id = $1`,
      [RSS_PROBE_ID],
    );
    expect(state.rows[0].consecutive_failures).toBe(1);
    expect(state.rows[0].schedule_reason).toBe("backoff");
    expect(state.rows[0].last_error_code).toBe("timeout");
    expect(state.rows[0].backing_off).toBe(true);
    expect(state.rows[0].etag).toBe('"v2"'); // conditional state survives errors

    const run = await pool.query(
      "SELECT status FROM collector_runs ORDER BY id DESC LIMIT 1",
    );
    expect(run.rows[0].status).toBe("failed");
  });

  it("retention expires items into content-free tombstones that still dedupe", async () => {
    await pool.query(
      "UPDATE collected_items SET expires_at = now() - interval '1 minute'",
    );
    const retention = await purgeExpired(pool);
    expect(retention.expiredItems).toBe(2 * ALL_COUNT);
    expect(retention.tombstonesWritten).toBe(2 * ALL_COUNT);

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'dedupe_tombstones'`,
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    expect(names).not.toContain("title");
    expect(names).not.toContain("summary");

    await pool.query(
      "UPDATE source_runtime_state SET next_poll_at = now(), backoff_until = NULL",
    );
    const one: ItemSpec[] = [
      { guid: "g1", title: "Story one about a fixture flaw", link: "https://x.example/1" },
    ];
    const fetcher: Fetcher = async () => ok(feedXml(one), '"v3"');
    const summary = await runCollectorCycle(pool, {
      batchLimit: ALL_COUNT,
      fetcher,
      apiFetchers: apiStub(one),
    });
    expect(summary.newItems).toBe(0); // tombstones blocked resurrection
    expect(summary.duplicates).toBe(ALL_COUNT);
  });
});

describe("collector helpers (no DB)", () => {
  it("parses the RSS ttl hint into seconds", () => {
    expect(rssTtlSeconds("<channel><ttl>15</ttl></channel>")).toBe(900);
    expect(rssTtlSeconds("<channel><ttl> 60 </ttl></channel>")).toBe(3600);
    expect(rssTtlSeconds("<channel></channel>")).toBeUndefined();
    expect(rssTtlSeconds("<ttl>0</ttl>")).toBeUndefined();
  });

  it("groups due sources by endpoint host", () => {
    const entryFor = (id: string) =>
      ({
        "a-1": { endpoint: "https://feeds.example/a" },
        "a-2": { endpoint: "https://feeds.example/b" },
        "b-1": { endpoint: "https://other.example/x" },
      })[id] as never;
    const groups = groupByHost(
      [
        { sourceId: "a-1", state: {} as never },
        { sourceId: "b-1", state: {} as never },
        { sourceId: "a-2", state: {} as never },
      ],
      entryFor,
    );
    expect(groups).toHaveLength(2);
    const sizes = groups.map((g) => g.length).sort();
    expect(sizes).toEqual([1, 2]);
  });
});
