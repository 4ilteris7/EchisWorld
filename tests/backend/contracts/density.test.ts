// F6B exit evidence: news-volume density — window filtering, region/domain
// grouping, the explicit metric contract, and that a real build populates
// processed_events. Against the disposable test database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { densityForWindow } from "@/lib/backend/repositories/processedEventsRepo";
import { GET } from "@/app/api/analytics/density/route";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) {
  process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WEB = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
}

const url = (w?: string) =>
  new Request(`http://localhost/api/analytics/density${w ? `?window=${w}` : ""}`);

async function seedEvent(
  pool: Pool,
  opts: {
    source: string;
    fp: string;
    hoursAgo: number;
    region: string | null;
    domain: string;
  },
): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO collected_items
       (source_id, fingerprint, title, collected_at, verification, basis,
        extraction, published_at, expires_at)
     VALUES ($1, $2, $3, now(), 'reported', 'single_public_source', 'rss_summary',
             now() - make_interval(hours => $4), now() + interval '47 hours')
     RETURNING id`,
    [opts.source, opts.fp, `Item ${opts.fp}`, opts.hoursAgo],
  );
  await pool.query(
    `INSERT INTO processed_events
       (item_id, accepted, primary_domain, marker_eligibility, region,
        analysis_version, published_at, expires_at)
     VALUES ($1, true, $2, 'feed_only', $3, 1,
             now() - make_interval(hours => $4), now() + interval '47 hours')`,
    [rows[0].id, opts.domain, opts.region, opts.hoursAgo],
  );
}

describe.skipIf(!hasDb)("news-volume density (F6B)", () => {
  let pg: typeof import("pg");
  let pool: Pool;

  beforeAll(async () => {
    pg = await import("pg");
    pool = new pg.Pool({ connectionString: TEST_URL, max: 3 });
    const { migrate } = await import("../../../scripts/db-migrate.mjs");
    await migrate({ log: () => {} });
    await pool.query(
      "TRUNCATE collected_items, processed_events RESTART IDENTITY CASCADE",
    );

    // 3 recent (within 6h) + 1 old (30h). Regions: europe×2, middle_east×1,
    // null×1. Domains: conflict×2, diplomacy×2.
    await seedEvent(pool, { source: "a", fp: "e1", hoursAgo: 1, region: "europe", domain: "conflict" });
    await seedEvent(pool, { source: "a", fp: "e2", hoursAgo: 2, region: "europe", domain: "diplomacy" });
    await seedEvent(pool, { source: "b", fp: "e3", hoursAgo: 3, region: "middle_east", domain: "conflict" });
    await seedEvent(pool, { source: "b", fp: "e4", hoursAgo: 30, region: null, domain: "diplomacy" });
  });

  afterAll(async () => {
    await pool?.end();
    const { closePools } = await import("@/lib/backend/db/pool");
    await closePools();
  });

  it("counts only items inside the window", async () => {
    const w6 = await densityForWindow(pool, 6);
    expect(w6.windowHours).toBe(6);
    expect(w6.totalItems).toBe(3); // the 30h item is excluded

    const w48 = await densityForWindow(pool, 48);
    expect(w48.totalItems).toBe(4); // all included
  });

  it("groups by region with shares summing to 1", async () => {
    const w48 = await densityForWindow(pool, 48);
    const byRegion = Object.fromEntries(
      w48.byRegion.map((b) => [b.key, b.count]),
    );
    expect(byRegion.europe).toBe(2);
    expect(byRegion.middle_east).toBe(1);
    expect(byRegion.unspecified).toBe(1); // null region bucketed honestly
    // sorted desc by count
    expect(w48.byRegion[0].count).toBeGreaterThanOrEqual(
      w48.byRegion[w48.byRegion.length - 1].count,
    );
    const shareSum = w48.byRegion.reduce((s, b) => s + b.share, 0);
    expect(shareSum).toBeCloseTo(1, 5);
  });

  it("groups by domain", async () => {
    const w48 = await densityForWindow(pool, 48);
    const byDomain = Object.fromEntries(
      w48.byDomain.map((b) => [b.key, b.count]),
    );
    expect(byDomain.conflict).toBe(2);
    expect(byDomain.diplomacy).toBe(2);
  });

  it("API exposes the explicit news-volume metric contract", async () => {
    const res = await GET(url("24"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await res.json();
    expect(body.metric.id).toBe("news_volume");
    expect(body.metric.provenance).toBe("derived_from_open_source_news");
    expect(typeof body.metric.note).toBe("string");
    expect(body.windowHours).toBe(24);
    expect(Array.isArray(body.byRegion)).toBe(true);
    expect(Array.isArray(body.byDomain)).toBe(true);
  });

  it("defaults to a 24h window and rejects unknown windows", async () => {
    expect((await (await GET(url())).json()).windowHours).toBe(24);
    const bad = await GET(url("7"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).allowedWindows).toEqual([6, 12, 24, 48]);
  });
});
