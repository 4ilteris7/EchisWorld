// F3A exit evidence: payload build/swap contract + API cache/stale/304/
// unavailable behavior, all against the disposable test database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  composeCyberPayload,
  storeCyberPayload,
  readCyberPayload,
} from "@/lib/backend/payloads/cyberPayload";
import { GET } from "@/app/api/feeds/cyber/route";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) {
  process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WEB = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
}

const REQ = () => new Request("http://localhost/api/feeds/cyber");

describe.skipIf(!hasDb)("cyber derived payload (F3A)", () => {
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

    // Seed: pilot state rows (recent success) + 48h items for three sources.
    const { ensureSourceStateRows } = await import(
      "@/lib/backend/repositories/sourceStateRepo"
    );
    const { pilotManifestEntries } = await import(
      "@/lib/backend/collector/pilot"
    );
    await ensureSourceStateRows(pool, pilotManifestEntries());
    await pool.query(
      "UPDATE source_runtime_state SET last_success_at = now()",
    );

    let n = 0;
    for (const sourceId of ["the-hacker-news", "bleeping-computer", "the-record"]) {
      for (let i = 0; i < 5; i++) {
        n += 1;
        await pool.query(
          `INSERT INTO collected_items
             (source_id, upstream_item_id, url, canonical_url, fingerprint, title,
              summary, published_at, collected_at, verification, basis, extraction,
              metadata, expires_at)
           VALUES ($1, $2, $3, $3, $4, $5, $6,
                   now() - make_interval(mins => $7), now(), 'reported',
                   'single_public_source', 'rss_summary',
                   '{"category":"Cyber Security"}', now() + interval '47 hours')`,
          [
            sourceId,
            `guid-${n}`,
            `https://x.example/${sourceId}/${i}`,
            `fp-${sourceId}-${i}`,
            `Ransomware campaign ${n} hits European healthcare providers`,
            `Synthetic summary ${n} describing an attack on hospitals in Germany.`,
            n * 10,
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

  it("composes a bounded, analyzed payload with honest coverage", async () => {
    const payload = await composeCyberPayload(pool);
    expect(payload.items.length).toBe(15);
    expect(payload.items.length).toBeLessThanOrEqual(200);
    // newest first
    const times = payload.items.map((i) => i.publishedAt ?? "");
    expect([...times].sort().reverse()).toEqual(times);
    // analysis ran server-side
    expect(payload.analysis.totalItems).toBe(15);
    expect(payload.analysis.regions.length).toBeGreaterThan(0);
    expect(payload.analysis.provenance).toBe("derived_from_rss_text");
    // F5 rollout: all 18 cyber sources enabled + fresh → state fresh.
    expect(payload.coverage.manifestSources).toBe(18);
    expect(payload.coverage.enabledSources).toBe(18);
    expect(payload.state).toBe("fresh");
    expect(payload.stateReasons).toEqual([]);
    // §16: single response stays under 1 MB
    expect(JSON.stringify(payload).length).toBeLessThan(1024 * 1024);
  });

  it("swaps current→previous atomically and keeps exactly two slots", async () => {
    const first = await composeCyberPayload(pool);
    await storeCyberPayload(pool, first, "b1");
    const second = await composeCyberPayload(pool);
    await storeCyberPayload(pool, second, "b2");
    const third = await composeCyberPayload(pool);
    await storeCyberPayload(pool, third, "b3");

    const { rows } = await pool.query(
      "SELECT slot, build_id FROM derived_payloads WHERE payload_type = 'cyber' ORDER BY slot",
    );
    expect(rows).toEqual([
      { slot: "current", build_id: "b3" },
      { slot: "previous", build_id: "b2" },
    ]);

    const stored = await readCyberPayload(pool);
    expect(stored?.slot).toBe("current");
    expect(stored?.payload.generatedAt).toBe(third.generatedAt);
  });

  it("API serves the payload with ETag and honors If-None-Match with 304", async () => {
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"cyber-/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await res.json();
    expect(body.state).toBe("fresh");
    expect(body.servedFromSlot).toBe("current");
    expect(body.items).toHaveLength(15);
    expect(typeof body.ageSeconds).toBe("number");

    const conditional = new Request("http://localhost/api/feeds/cyber", {
      headers: { "If-None-Match": etag! },
    });
    const res304 = await GET(conditional);
    expect(res304.status).toBe(304);
    expect(res304.headers.get("etag")).toBe(etag);
  });

  it("an aged payload is served as stale, not hidden", async () => {
    await pool.query(
      `UPDATE derived_payloads
          SET generated_at = now() - interval '2 hours'
        WHERE payload_type = 'cyber' AND slot = 'current'`,
    );
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("stale");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.ageSeconds).toBeGreaterThan(3600);
  });

  it("falls back to the previous slot as stale when current is gone", async () => {
    await pool.query(
      "DELETE FROM derived_payloads WHERE payload_type = 'cyber' AND slot = 'current'",
    );
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servedFromSlot).toBe("previous");
    expect(body.state).toBe("stale");
  });

  it("returns an explicit 503 unavailable when no payload exists at all", async () => {
    await pool.query("DELETE FROM derived_payloads WHERE payload_type = 'cyber'");
    const res = await GET(REQ());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.state).toBe("unavailable");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
