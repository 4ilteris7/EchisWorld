// F6A exit evidence: worker-built globe snapshot + atomic swap + API
// cache/stale/503, against the disposable test database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  composeGlobalArtifacts,
  maybeRebuildGlobalPayload,
} from "@/lib/backend/payloads/globalPayload";
import {
  composeGlobeSnapshot,
  readGlobeSnapshot,
} from "@/lib/backend/payloads/globeSnapshot";
import { GET } from "@/app/api/globe/snapshot/route";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) {
  process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WEB = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
}

const REQ = () => new Request("http://localhost/api/globe/snapshot");

// Anchor sources produce located markers → globe points.
const ANCHOR_A = "wam-uae-news";
const ANCHOR_B = "sana-en";

describe.skipIf(!hasDb)("globe activity snapshot (F6A)", () => {
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
      { src: ANCHOR_A, title: "UAE foreign minister meets delegation for ceasefire talks" },
      { src: ANCHOR_A, title: "Ministry condemns border strike, issues official statement" },
      { src: ANCHOR_B, title: "Military operation reported near Damascus, officials say" },
    ];
    for (const [i, s] of seed.entries()) {
      await pool.query(
        `INSERT INTO collected_items
           (source_id, upstream_item_id, url, canonical_url, fingerprint, title,
            summary, published_at, collected_at, verification, basis, extraction,
            expires_at)
         VALUES ($1, $2, $3, $3, $4, $5, $6,
                 now() - make_interval(hours => $7), now(), 'reported',
                 'single_public_source', 'rss_summary', now() + interval '47 hours')`,
        [
          s.src,
          `snapguid-${i}`,
          `https://x.example/${s.src}/${i}`,
          `snapfp-${s.src}-${i}`,
          s.title,
          `Synthetic geopolitical summary ${i} for the globe snapshot test.`,
          i, // 0..2 hours ago → inside the 24h activity window
        ],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
    const { closePools } = await import("@/lib/backend/db/pool");
    await closePools();
  });

  it("builds a scheduled-collector snapshot with located points", async () => {
    const { payload, acceptedEvents } = await composeGlobalArtifacts(pool);
    const snapshot = composeGlobeSnapshot(acceptedEvents, payload.state);

    expect(snapshot.sourceMode).toBe("scheduled_collector");
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.windowHours).toBe(24);
    expect(snapshot.points.length).toBeGreaterThanOrEqual(1);
    for (const point of snapshot.points) {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lng).toBeGreaterThanOrEqual(-180);
      expect(point.lng).toBeLessThanOrEqual(180);
      expect(point.itemCount).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(point.level);
    }
  });

  it("worker hook stores the snapshot alongside the global payload", async () => {
    const built = await maybeRebuildGlobalPayload(pool, true, "s1");
    expect(built).toBe(true);

    const stored = await readGlobeSnapshot(pool);
    expect(stored?.slot).toBe("current");
    expect(stored?.payload.sourceMode).toBe("scheduled_collector");
    expect(stored?.payload.points.length).toBeGreaterThanOrEqual(1);

    // Exactly the current slot exists for 'globe' after one build.
    const { rows } = await pool.query(
      "SELECT slot FROM derived_payloads WHERE payload_type = 'globe' ORDER BY slot",
    );
    expect(rows.map((r) => r.slot)).toEqual(["current"]);
  });

  it("API serves 200 + ETag → 304, stale on age, 503 when absent", async () => {
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"globe-/);
    const body = await res.json();
    expect(body.sourceMode).toBe("scheduled_collector");
    expect(body.points.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.ageSeconds).toBe("number");

    const res304 = await GET(
      new Request("http://localhost/api/globe/snapshot", {
        headers: { "If-None-Match": etag! },
      }),
    );
    expect(res304.status).toBe(304);

    await pool.query(
      `UPDATE derived_payloads SET generated_at = now() - interval '2 hours'
        WHERE payload_type = 'globe' AND slot = 'current'`,
    );
    expect((await (await GET(REQ())).json()).state).toBe("stale");

    await pool.query("DELETE FROM derived_payloads WHERE payload_type = 'globe'");
    expect((await GET(REQ())).status).toBe(503);
  });
});
