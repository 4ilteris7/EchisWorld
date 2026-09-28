// F4A exit evidence: defense payload contract + API behavior against the
// disposable test database (mirrors the accepted cyber contract).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  composeDefensePayload,
  maybeRebuildDefensePayload,
} from "@/lib/backend/payloads/defensePayload";
import { GET } from "@/app/api/feeds/defense/route";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) {
  process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WEB = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
}

const REQ = () => new Request("http://localhost/api/feeds/defense");

const SEED_SOURCES = ["breaking-defense", "defensenews-all", "naval-news"];

describe.skipIf(!hasDb)("defense derived payload (F4A)", () => {
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

    // Defense-relevant synthetic items (must pass the relevance gate).
    const titles = [
      "Navy awards frigate procurement contract to shipbuilder",
      "Air force expands UAV production line with new facility",
      "Defense ministry signs missile munitions export deal",
      "Contractor wins radar electronics modernization award",
      "Army orders armored vehicle batch under land systems program",
    ];
    let n = 0;
    for (const sourceId of SEED_SOURCES) {
      for (const [i, title] of titles.entries()) {
        n += 1;
        await pool.query(
          `INSERT INTO collected_items
             (source_id, upstream_item_id, url, canonical_url, fingerprint, title,
              summary, published_at, collected_at, verification, basis, extraction,
              expires_at)
           VALUES ($1, $2, $3, $3, $4, $5, $6,
                   now() - make_interval(mins => $7), now(), 'reported',
                   'single_public_source', 'rss_summary', now() + interval '47 hours')`,
          [
            sourceId,
            `dguid-${n}`,
            `https://x.example/${sourceId}/${i}`,
            `dfp-${sourceId}-${i}`,
            `${title} (${sourceId})`,
            `Synthetic defense industry summary ${n} about procurement and production.`,
            n * 7,
          ],
        );
      }
    }
  });

  afterAll(async () => {
    await pool?.end();
    const { closePools } = await import("@/lib/backend/db/pool");
    await closePools();
  });

  it("composes a bounded payload with the finished screen analysis", async () => {
    const payload = await composeDefensePayload(pool);
    expect(payload.analysis.totalItems).toBe(15);
    expect(payload.analysis.relevantItems).toBeGreaterThan(0);
    expect(payload.analysis.items.length).toBeGreaterThan(0);
    expect(payload.analysis.segments.length).toBeGreaterThan(0);
    expect(payload.analysis.provenance).toBe("derived_from_rss_text");
    // All 14 defense sources are enabled since F4A → no pilot-scope reason.
    expect(payload.coverage.manifestSources).toBe(14);
    expect(payload.coverage.enabledSources).toBe(14);
    expect(payload.state).toBe("fresh");
    expect(JSON.stringify(payload).length).toBeLessThan(1024 * 1024);
  });

  it("worker hook stores the payload and skips rebuilds while young", async () => {
    const built = await maybeRebuildDefensePayload(pool, true, "d1");
    expect(built).toBe(true);
    const skipped = await maybeRebuildDefensePayload(pool, false, "d2");
    expect(skipped).toBe(false);

    const { rows } = await pool.query(
      "SELECT slot, build_id FROM derived_payloads WHERE payload_type = 'defense'",
    );
    expect(rows).toEqual([{ slot: "current", build_id: "d1" }]);
  });

  it("API serves 200 + ETag, then 304 on If-None-Match", async () => {
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"defense-/);
    const body = await res.json();
    expect(body.state).toBe("fresh");
    expect(body.analysis.items.length).toBeGreaterThan(0);

    const res304 = await GET(
      new Request("http://localhost/api/feeds/defense", {
        headers: { "If-None-Match": etag! },
      }),
    );
    expect(res304.status).toBe(304);
  });

  it("aged payload serves as stale; missing payload returns 503", async () => {
    await pool.query(
      `UPDATE derived_payloads SET generated_at = now() - interval '2 hours'
        WHERE payload_type = 'defense' AND slot = 'current'`,
    );
    const stale = await GET(REQ());
    expect((await stale.json()).state).toBe("stale");

    await pool.query("DELETE FROM derived_payloads WHERE payload_type = 'defense'");
    const gone = await GET(REQ());
    expect(gone.status).toBe(503);
    expect((await gone.json()).state).toBe("unavailable");
  });
});
