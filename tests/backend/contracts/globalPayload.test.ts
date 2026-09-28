// F5 exit evidence: the browser pipeline's server-side run — filter + geo +
// markers over DB items — plus API contract, against the test database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  composeGlobalPayload,
  maybeRebuildGlobalPayload,
} from "@/lib/backend/payloads/globalPayload";
import { GET } from "@/app/api/feeds/global/route";
import { manifestSourceIdsForScreen } from "@/lib/backend/sources/manifest";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) {
  process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WEB = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
}

const REQ = () => new Request("http://localhost/api/feeds/global");

// Monitor-set sources with different marker strategies:
//   tass-world → item_location (text-resolved)
//   wam-uae-news → source_location (institutional anchor in sourceDefinitions)
const TEXT_SOURCE = "tass-world";
const ANCHOR_SOURCE = "wam-uae-news";
const MONITOR_SOURCE_COUNT = manifestSourceIdsForScreen("monitor").length;

describe.skipIf(!hasDb)("global derived payload (F5)", () => {
  let pg: typeof import("pg");
  let pool: Pool;

  beforeAll(async () => {
    pg = await import("pg");
    pool = new pg.Pool({ connectionString: TEST_URL, max: 3 });
    const { migrate } = await import("../../../scripts/db-migrate.mjs");
    await migrate({ log: () => {} });
    await pool.query(
      "TRUNCATE collected_items, derived_payloads RESTART IDENTITY CASCADE",
    );
    await pool.query("DELETE FROM source_runtime_state");

    const { ensureSourceStateRows } = await import(
      "@/lib/backend/repositories/sourceStateRepo"
    );
    const { pilotManifestEntries } = await import(
      "@/lib/backend/collector/pilot"
    );
    await ensureSourceStateRows(pool, pilotManifestEntries());
    await pool.query("UPDATE source_runtime_state SET last_success_at = now()");

    const seed = [
      // Geopolitical items that must pass the filter gate.
      { src: TEXT_SOURCE, title: "Missile strike hits military base near Kharkiv, officials report" },
      { src: TEXT_SOURCE, title: "Foreign ministry issues warning over border clashes in Syria" },
      { src: ANCHOR_SOURCE, title: "UAE foreign minister meets delegation for ceasefire talks" },
      // Noise the filter gate should reject.
      { src: TEXT_SOURCE, title: "Ten best summer dessert recipes for the weekend" },
    ];
    for (const [i, s] of seed.entries()) {
      await pool.query(
        `INSERT INTO collected_items
           (source_id, upstream_item_id, url, canonical_url, fingerprint, title,
            summary, published_at, collected_at, verification, basis, extraction,
            metadata, expires_at)
         VALUES ($1, $2, $3, $3, $4, $5, $6,
                 now() - make_interval(mins => $7), now(), 'reported',
                 'single_public_source', 'rss_summary',
                 '{"relatedRegions":["global"]}', now() + interval '47 hours')`,
        [
          s.src,
          `gguid-${i}`,
          `https://x.example/${s.src}/${i}`,
          `gfp-${s.src}-${i}`,
          s.title,
          `Synthetic geopolitical summary ${i} for the pipeline test.`,
          (i + 1) * 11,
        ],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
    const { closePools } = await import("@/lib/backend/db/pool");
    await closePools();
  });

  it("runs the full filter+geo pipeline server-side and bounds the payload", async () => {
    const payload = await composeGlobalPayload(pool);
    expect(payload.totalWindowItems).toBe(4);
    // Relevance gate: geopolitical items in, dessert recipes out.
    expect(payload.events.length).toBeGreaterThanOrEqual(2);
    expect(payload.events.length).toBeLessThanOrEqual(200);
    expect(payload.rejectedCount).toBeGreaterThanOrEqual(1);
    expect(
      payload.events.every((e) => e.primaryDomain && e.priorityScore >= 0),
    ).toBe(true);
    // Institutional anchor source produces a located marker.
    expect(payload.markers.length).toBeGreaterThanOrEqual(1);
    const eventIds = new Set(payload.events.map((e) => e.id));
    for (const marker of payload.markers) {
      expect(marker.lat).toBeGreaterThanOrEqual(-90);
      expect(marker.lat).toBeLessThanOrEqual(90);
      expect(marker.lng).toBeGreaterThanOrEqual(-180);
      expect(marker.lng).toBeLessThanOrEqual(180);
      // Markers reference events by id (no embedded copies) and every id
      // resolves against the events array (client rehydration is total).
      expect(Array.isArray(marker.itemIds)).toBe(true);
      expect(marker).not.toHaveProperty("items");
      for (const id of marker.itemIds) expect(eventIds.has(id)).toBe(true);
    }
    // Heavy/duplicated fields are stripped from persisted events (§16 size):
    // the nested item, filter-debug arrays, and pipeline scratch text.
    for (const event of payload.events) {
      expect(event).not.toHaveProperty("item");
      expect(event).not.toHaveProperty("matches");
      expect(event).not.toHaveProperty("matchedKeywords");
    }
    // §16: the whole response stays under the 1 MB hard limit even with full
    // (untruncated) summaries, because markers no longer duplicate events.
    expect(JSON.stringify(payload).length).toBeLessThan(1024 * 1024);
  });

  it("reports per-source health for the Sources screen", async () => {
    const payload = await composeGlobalPayload(pool);
    const tass = payload.sourceStatus.find((s) => s.sourceId === TEXT_SOURCE);
    expect(tass?.itemCount48h).toBe(3);
    expect(tass?.lastSuccessAt).toBeTruthy();
    expect(payload.coverage.manifestSources).toBe(MONITOR_SOURCE_COUNT);
    expect(payload.coverage.enabledSources).toBe(MONITOR_SOURCE_COUNT);
  });

  it("API serves 200 + ETag → 304, stale on age, 503 when absent", async () => {
    const built = await maybeRebuildGlobalPayload(pool, true, "g1");
    expect(built).toBe(true);

    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"global-/);
    const body = await res.json();
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.sourceStatus.length).toBe(MONITOR_SOURCE_COUNT);

    const res304 = await GET(
      new Request("http://localhost/api/feeds/global", {
        headers: { "If-None-Match": etag! },
      }),
    );
    expect(res304.status).toBe(304);

    await pool.query(
      `UPDATE derived_payloads SET generated_at = now() - interval '2 hours'
        WHERE payload_type = 'global' AND slot = 'current'`,
    );
    expect((await (await GET(REQ())).json()).state).toBe("stale");

    await pool.query("DELETE FROM derived_payloads WHERE payload_type = 'global'");
    expect((await GET(REQ())).status).toBe(503);
  });
});
